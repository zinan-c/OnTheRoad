import { PostgresExecutor } from "@on-the-road/database/postgres";
import { GeocoderError, type Geocoder } from "@on-the-road/providers/geocoding";

export type GeocodingBatchCounts = Readonly<{
  total: number;
  queued: number;
  resolving: number;
  resolved: number;
  ambiguous: number;
  failed: number;
  cancelled: number;
}>;

export function deriveGeocodingBatchStatus(
  counts: GeocodingBatchCounts,
  cancelRequested: boolean,
): "running" | "completed" | "completed_with_warnings" | "cancelled" {
  if (cancelRequested && counts.queued + counts.resolving === 0) return "cancelled";
  if (counts.queued + counts.resolving > 0) return "running";
  if (counts.ambiguous + counts.failed > 0) return "completed_with_warnings";
  return "completed";
}

export function deriveImportJobReadiness(
  unresolvedRows: number,
  cancelRequested: boolean,
): "ready_to_import" | "confirmation_required" | "cancelled" {
  if (cancelRequested) return "cancelled";
  return unresolvedRows > 0 ? "confirmation_required" : "ready_to_import";
}

export function geocodingRetryDelay(
  attempt: number,
  options: { readonly baseBackoffMs: number; readonly maxBackoffMs: number; readonly retryAfterSeconds?: number },
): number {
  const providerDelay = options.retryAfterSeconds === undefined
    ? options.baseBackoffMs * 2 ** Math.max(0, attempt - 1)
    : options.retryAfterSeconds * 1_000;
  return Math.min(Math.max(providerDelay, options.baseBackoffMs), options.maxBackoffMs);
}

type BatchRecord = {
  id: string;
  status: string;
  cancel_requested_at: string | null;
};

type BatchJob = {
  id: string;
  batch_id: string;
  trip_id: string;
  import_staging_id: string;
  provider: string;
  query: string;
  context: Record<string, unknown>;
  attempt_count: number;
  max_attempts: number;
  map_profile: string;
};

export type GeocodingBatchProcessorOptions = Readonly<{
  databaseUrl?: string;
  executor?: PostgresExecutor;
  geocoder: Geocoder;
  maxConcurrency?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  clock?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
}>;

export class PostgresGeocodingBatchProcessor {
  readonly #database: PostgresExecutor;
  readonly #geocoder: Geocoder;
  readonly #maxConcurrency: number;
  readonly #baseBackoffMs: number;
  readonly #maxBackoffMs: number;
  readonly #clock: () => Date;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(options: GeocodingBatchProcessorOptions) {
    this.#database = options.executor ?? new PostgresExecutor({
      databaseUrl: options.databaseUrl,
      role: "worker",
    });
    this.#geocoder = options.geocoder;
    this.#maxConcurrency = options.maxConcurrency ?? 4;
    this.#baseBackoffMs = options.baseBackoffMs ?? 500;
    this.#maxBackoffMs = options.maxBackoffMs ?? 30_000;
    this.#clock = options.clock ?? (() => new Date());
    this.#sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    if (!Number.isSafeInteger(this.#maxConcurrency) || this.#maxConcurrency < 1 || this.#maxConcurrency > 32) {
      throw new RangeError("Geocoding concurrency must be between 1 and 32");
    }
  }

  async process(batchId: string): Promise<void> {
    await this.#markRunning(batchId);
    for (;;) {
      const batch = await this.#getBatch(batchId);
      if (!batch || ["completed", "completed_with_warnings", "failed", "cancelled"].includes(batch.status)) return;

      if (batch.cancel_requested_at) await this.#cancelQueued(batchId);
      const jobs = await this.#claimJobs(batchId, this.#maxConcurrency);
      if (jobs.length > 0) {
        await Promise.all(jobs.map((job) => this.#resolve(job)));
        await this.#reconcile(batchId);
        continue;
      }

      await this.#reconcile(batchId);
      const refreshed = await this.#getBatch(batchId);
      if (!refreshed || ["completed", "completed_with_warnings", "failed", "cancelled"].includes(refreshed.status)) return;
      await this.#sleep(Math.min(Math.max(await this.#nextRetryDelay(batchId), 25), 1_000));
    }
  }

  async listRecoverableBatchIds(limit = 100): Promise<string[]> {
    const result = await this.#database.query<{ id: string }>(
      `SELECT id
       FROM geocoding_batch
       WHERE status IN ('queued', 'running', 'waiting_rate_limit', 'cancelling')
       ORDER BY updated_at, id
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(({ id }) => id);
  }

  close(): Promise<void> { return this.#database.close(); }

  async #markRunning(batchId: string): Promise<void> {
    await this.#database.query(
      `UPDATE geocoding_batch
       SET status = CASE WHEN status = 'queued' THEN 'running' ELSE status END,
           updated_at = now()
       WHERE id = $1::uuid
         AND status IN ('queued', 'running', 'waiting_rate_limit', 'cancelling')`,
      [batchId],
    );
  }

  async #getBatch(batchId: string): Promise<BatchRecord | null> {
    return (await this.#database.query<BatchRecord>(
      `SELECT id, status, cancel_requested_at
       FROM geocoding_batch WHERE id = $1::uuid`,
      [batchId],
    )).rows[0] ?? null;
  }

  async #claimJobs(batchId: string, limit: number): Promise<BatchJob[]> {
    return (await this.#database.query<BatchJob>(
      `WITH next_jobs AS (
         SELECT j.id
         FROM geocoding_job j
         WHERE j.batch_id = $1::uuid
           AND j.status IN ('queued', 'retry_scheduled')
           AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= now())
         ORDER BY j.created_at, j.id
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE geocoding_job j
       SET status = 'running', attempt_count = j.attempt_count + 1,
           next_attempt_at = NULL, updated_at = now()
       FROM next_jobs n
       WHERE j.id = n.id AND j.batch_id = $1::uuid
       RETURNING j.id, j.batch_id, j.trip_id, j.import_staging_id,
                 j.provider, j.query, j.context, j.attempt_count,
                 j.max_attempts,
                 (SELECT b.map_profile FROM geocoding_batch b WHERE b.id = j.batch_id) AS map_profile`,
      [batchId, limit],
    )).rows;
  }

  async #resolve(job: BatchJob): Promise<void> {
    try {
      const context = job.context ?? {};
      const countryCodes = Array.isArray(context.countryCodes)
        ? context.countryCodes.filter((value): value is string => typeof value === "string")
        : undefined;
      const candidates = await this.#geocoder.search({
        query: job.query,
        limit: 5,
        trigger: "batch",
        context: {
          ...(countryCodes ? { countryCodes } : {}),
          mapProfile: job.map_profile,
        },
      });
      const status = candidates.length === 0 ? "failed" : candidates.length === 1 ? "resolved" : "ambiguous";
      await this.#database.transaction(async (client) => {
        const batch = (await client.query<{ cancel_requested_at: string | null }>(
          `SELECT cancel_requested_at FROM geocoding_batch WHERE id = $1::uuid FOR UPDATE`,
          [job.batch_id],
        )).rows[0];
        const cancelled = Boolean(batch?.cancel_requested_at);
        const nextStatus = cancelled ? "cancelled" : status;
        await client.query(
          `UPDATE geocoding_job
           SET status = $2, candidates = $3::jsonb,
               error_code = $4, completed_at = now(), updated_at = now()
           WHERE id = $1::uuid AND status = 'running'`,
          [job.id, nextStatus, JSON.stringify(candidates), candidates.length === 0 ? "NO_RESULTS" : null],
        );
        if (!cancelled && candidates.length > 0) {
          await client.query(
            `UPDATE import_location_staging
             SET staged_location = staged_location || jsonb_build_object(
               'provider', $2, 'candidates', $3::jsonb
             ), updated_at = now(), version = version + 1
             WHERE id = $1::uuid`,
            [job.import_staging_id, job.provider, JSON.stringify(candidates)],
          );
        }
      });
    } catch (error) {
      await this.#handleFailure(job, error);
    }
  }

  async #handleFailure(job: BatchJob, error: unknown): Promise<void> {
    const providerError = error instanceof GeocoderError ? error : null;
    const retryable = providerError?.retryable === true;
    const exhausted = job.attempt_count >= job.max_attempts;
    if (retryable && !exhausted) {
      const delay = geocodingRetryDelay(job.attempt_count, {
        baseBackoffMs: this.#baseBackoffMs,
        maxBackoffMs: this.#maxBackoffMs,
        ...(providerError?.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: providerError.retryAfterSeconds }),
      });
      await this.#database.query(
        `UPDATE geocoding_job
         SET status = 'retry_scheduled',
             next_attempt_at = now() + ($2::integer * interval '1 millisecond'),
             error_code = $3, updated_at = now()
         WHERE id = $1::uuid AND status = 'running'`,
        [job.id, Math.round(delay), providerError?.code ?? "PROVIDER_UNAVAILABLE"],
      );
      return;
    }
    await this.#database.query(
      `UPDATE geocoding_job
       SET status = 'failed', error_code = $2, completed_at = now(), updated_at = now()
       WHERE id = $1::uuid AND status = 'running'`,
      [job.id, providerError?.code ?? "GEOCODING_FAILED"],
    );
  }

  async #cancelQueued(batchId: string): Promise<void> {
    await this.#database.query(
      `UPDATE geocoding_job
       SET status = 'cancelled', completed_at = now(), updated_at = now()
       WHERE batch_id = $1::uuid AND status IN ('queued', 'retry_scheduled')`,
      [batchId],
    );
  }

  async #nextRetryDelay(batchId: string): Promise<number> {
    const result = await this.#database.query<{ delay_ms: number | null }>(
      `SELECT COALESCE(
         EXTRACT(EPOCH FROM (min(next_attempt_at) - now())) * 1000, 100
       )::integer AS delay_ms
       FROM geocoding_job WHERE batch_id = $1::uuid AND status = 'retry_scheduled'`,
      [batchId],
    );
    return Math.max(25, Number(result.rows[0]?.delay_ms ?? 100));
  }

  async #reconcile(batchId: string): Promise<void> {
    await this.#database.transaction(async (client) => {
      const counts = (await client.query<GeocodingBatchCounts & { cancel_requested_at: string | null }>(
        `SELECT count(*)::integer AS total,
                count(*) FILTER (WHERE status IN ('queued', 'retry_scheduled'))::integer AS queued,
                count(*) FILTER (WHERE status = 'running')::integer AS resolving,
                count(*) FILTER (WHERE status = 'resolved')::integer AS resolved,
                count(*) FILTER (WHERE status = 'ambiguous')::integer AS ambiguous,
                count(*) FILTER (WHERE status = 'failed')::integer AS failed,
                count(*) FILTER (WHERE status = 'cancelled')::integer AS cancelled,
                max(b.cancel_requested_at) AS cancel_requested_at
         FROM geocoding_job j
         JOIN geocoding_batch b ON b.id = j.batch_id
         WHERE j.batch_id = $1::uuid`,
        [batchId],
      )).rows[0];
      if (!counts) return;
      const terminal = counts.queued + counts.resolving === 0;
      const status = deriveGeocodingBatchStatus(counts, Boolean(counts.cancel_requested_at));
      await client.query(
        `UPDATE geocoding_batch
         SET status = $2, total_units = $3, queued_units = $4,
             resolving_units = $5, resolved_units = $6, ambiguous_units = $7,
             failed_units = $8, cancelled_units = $9,
             completed_at = CASE WHEN $10::boolean THEN COALESCE(completed_at, now()) ELSE completed_at END,
             updated_at = now()
         WHERE id = $1::uuid`,
        [batchId, status, counts.total, counts.queued, counts.resolving,
          counts.resolved, counts.ambiguous, counts.failed, counts.cancelled, terminal],
      );
      if (terminal) {
        const unresolvedRows = (await client.query<{ count: number }>(
          `SELECT count(*)::integer AS count
           FROM import_row r
           JOIN geocoding_batch b ON b.import_job_id = r.import_job_id
           WHERE b.id = $1::uuid AND r.status = 'unresolved'`,
          [batchId],
        )).rows[0]?.count ?? 0;
        const importStatus = deriveImportJobReadiness(
          unresolvedRows,
          status === "cancelled",
        );
        await client.query(
          `UPDATE import_job j
           SET status = $2,
               stage = $2,
               completed_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE completed_at END,
               updated_at = now()
           FROM geocoding_batch b
           WHERE b.id = $1::uuid AND j.id = b.import_job_id
             AND j.status IN ('geocoding', 'confirmation_required')`,
          [batchId, importStatus],
        );
      }
    });
  }
}
