import { UnrecoverableError, type Job } from "bullmq";

import { PostgresExecutor } from "@on-the-road/database/postgres";
import { assertJobEvent, type JobEvent } from "@on-the-road/database/jobs";
import { PostgresRouteRebuildProcessor } from "../directions/postgres-route-rebuild.js";
import type { DirectionsProvider } from "@on-the-road/providers";

const SUPPORTED_EVENTS = new Set([
  "itinerary.order.changed",
  "route.rebuild.requested",
  "trip.created",
  "trip.updated",
]);

export class PostgresEventProcessor {
  readonly #database: PostgresExecutor;
  readonly #routes: PostgresRouteRebuildProcessor;

  constructor(databaseUrl: string, directions: { provider: DirectionsProvider; name: string }) {
    this.#database = new PostgresExecutor({
      databaseUrl,
      role: "worker",
    });
    this.#routes = new PostgresRouteRebuildProcessor(databaseUrl, {
      directions: directions.provider,
      providerName: directions.name,
    });
  }

  async process(job: Job): Promise<{
    eventId: string;
    applied: boolean;
  }> {
    if (!SUPPORTED_EVENTS.has(job.name)) {
      throw Object.assign(
        new Error(`No application processor is registered for ${job.name}`),
        { code: "WORKER_PROCESSOR_UNSUPPORTED", retryable: false },
      );
    }
    const candidate = job.data as Record<string, unknown>;
    assertJobEvent(candidate);
    const event: JobEvent = candidate;
    try {
      if (event.eventType === "route.rebuild.requested") {
        return await this.#routes.process(event);
      }
      const applied = await this.#database.transaction(async (client) => {
        const inbox = await client.query(
          `INSERT INTO job_inbox (
            consumer_name, event_id, schema_version
          ) VALUES ($1, $2, $3)
          ON CONFLICT (consumer_name, event_id) DO NOTHING
          RETURNING event_id`,
          ["application-worker", event.eventId, event.schemaVersion],
        );
        if (inbox.rowCount === 0) return false;
        const handled = await client.query(
          `UPDATE job_outbox
           SET handled_at = now(),
               locked_until = NULL,
               last_error_code = NULL
           WHERE event_id = $1
             AND event_type = $2
           RETURNING event_id`,
          [event.eventId, event.eventType],
        );
        if (handled.rowCount !== 1) {
          throw Object.assign(
            new Error("Worker event has no matching authoritative outbox row."),
            { code: "WORKER_OUTBOX_EVENT_MISSING", retryable: true },
          );
        }
        return true;
      });
      return { eventId: event.eventId, applied };
    } catch (error) {
      await this.#recordFailure(job, event, error).catch(() => undefined);
      const retryable = isRetryable(error);
      const attempts = (job.attemptsMade ?? 0) + 1;
      const maxAttempts = job.opts.attempts ?? 1;
      if (!retryable || attempts >= maxAttempts) {
        throw new UnrecoverableError(errorCode(error));
      }
      throw error;
    }
  }

  async #recordFailure(job: Job, event: JobEvent, error: unknown): Promise<void> {
    const retryable = isRetryable(error);
    const attempts = (job.attemptsMade ?? 0) + 1;
    const maxAttempts = job.opts.attempts ?? 1;
    const terminal = !retryable || attempts >= maxAttempts;
    const delayMs = Math.min(30_000, 500 * 2 ** Math.max(0, attempts - 1));
    await this.#database.query(
      `UPDATE job_outbox
       SET last_error_code = $2,
           next_attempt_at = CASE WHEN $3::boolean THEN now() ELSE now() + ($4::integer * interval '1 millisecond') END,
           handled_at = CASE WHEN $3::boolean THEN COALESCE(handled_at, now()) ELSE handled_at END,
           locked_until = NULL
       WHERE event_id = $1
         AND event_type = $5`,
      [event.eventId, errorCode(error), terminal, delayMs, event.eventType],
    );
  }

  async close(): Promise<void> {
    await Promise.all([
      this.#database.close(),
      this.#routes.close(),
    ]);
  }
}

function isRetryable(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "retryable" in error
    && typeof error.retryable === "boolean") {
    return error.retryable;
  }
  return true;
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string" && error.code.trim()) {
    return error.code;
  }
  return error instanceof Error && error.name ? error.name : "WORKER_EVENT_FAILED";
}
