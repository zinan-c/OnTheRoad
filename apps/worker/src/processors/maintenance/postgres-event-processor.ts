import type { Job } from "bullmq";

import { PostgresExecutor } from "@on-the-road/database/postgres";
import { assertJobEvent, type JobEvent } from "@on-the-road/database/jobs";

const SUPPORTED_EVENTS = new Set([
  "itinerary.order.changed",
  "trip.created",
  "trip.updated",
]);

export class PostgresEventProcessor {
  readonly #database: PostgresExecutor;

  constructor(databaseUrl: string) {
    this.#database = new PostgresExecutor({
      databaseUrl,
      role: "worker",
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
  }

  close(): Promise<void> {
    return this.#database.close();
  }
}
