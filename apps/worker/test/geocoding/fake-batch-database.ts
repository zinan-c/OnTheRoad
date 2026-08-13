type BatchJobState = {
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
  status: "queued" | "running" | "retry_scheduled" | "resolved" | "ambiguous" | "failed" | "cancelled";
  candidates: unknown[];
  error_code: string | null;
  next_attempt_at: number | null;
};

export type FakeGeocodingJob = Readonly<{
  id: string;
  query: string;
  stagingId?: string;
  maxAttempts?: number;
  context?: Record<string, unknown>;
}>;

export class FakeGeocodingDatabase {
  readonly batchId = "00000000-0000-4000-8000-000000000101";
  readonly tripId = "00000000-0000-4000-8000-000000000102";
  readonly batch = {
    id: this.batchId,
    status: "queued" as string,
    cancelRequestedAt: null as string | null,
    total: 0,
    queued: 0,
    resolving: 0,
    resolved: 0,
    ambiguous: 0,
    failed: 0,
    cancelled: 0,
  };
  readonly jobs: BatchJobState[];
  readonly stagedLocations = new Map<string, Record<string, unknown>>();
  readonly retryDelays: number[] = [];
  importJobStatus = "geocoding";
  unresolvedRows = 0;

  constructor(jobs: readonly FakeGeocodingJob[]) {
    this.jobs = jobs.map((job, index) => ({
      id: job.id,
      batch_id: this.batchId,
      trip_id: this.tripId,
      import_staging_id: job.stagingId ?? `staging-${index + 1}`,
      provider: "fixture",
      query: job.query,
      context: job.context ?? {},
      attempt_count: 0,
      max_attempts: job.maxAttempts ?? 4,
      map_profile: "cn_primary",
      status: "queued",
      candidates: [],
      error_code: null,
      next_attempt_at: null,
    }));
    this.batch.total = this.jobs.length;
    this.batch.queued = this.jobs.length;
  }

  async query<T = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number }> {
    const sql = text.replace(/\s+/gu, " ").trim();

    if (sql.startsWith("UPDATE geocoding_batch SET status = CASE WHEN status = 'queued'")) {
      if (this.batch.status === "queued") this.batch.status = "running";
      return result();
    }
    if (sql.startsWith("SELECT id, status, cancel_requested_at FROM geocoding_batch")) {
      return result([{
        id: this.batch.id,
        status: this.batch.status,
        cancel_requested_at: this.batch.cancelRequestedAt,
      } as T]);
    }
    if (sql.startsWith("SELECT id FROM geocoding_batch WHERE status IN")) {
      return result(this.batch.status === "queued"
        || this.batch.status === "running"
        || this.batch.status === "waiting_rate_limit"
        || this.batch.status === "cancelling"
        ? [{ id: this.batch.id } as T]
        : []);
    }
    if (sql.startsWith("WITH next_jobs AS")) {
      const limit = Number(values[1] ?? 0);
      const jobs = this.jobs
        .filter((job) => (job.status === "queued" || job.status === "retry_scheduled")
          && (job.next_attempt_at === null || job.next_attempt_at <= Date.now()))
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, limit);
      return result(jobs.map((job) => {
        job.status = "running";
        job.attempt_count += 1;
        job.next_attempt_at = null;
        return {
          id: job.id,
          batch_id: job.batch_id,
          trip_id: job.trip_id,
          import_staging_id: job.import_staging_id,
          provider: job.provider,
          query: job.query,
          context: job.context,
          attempt_count: job.attempt_count,
          max_attempts: job.max_attempts,
          map_profile: job.map_profile,
        } as T;
      }));
    }
    if (sql.startsWith("SELECT cancel_requested_at FROM geocoding_batch")) {
      return result([{ cancel_requested_at: this.batch.cancelRequestedAt } as T]);
    }
    if (sql.startsWith("UPDATE geocoding_job SET status = $2, candidates")) {
      const job = this.findJob(String(values[0]));
      if (job?.status === "running") {
        const candidates = JSON.parse(String(values[2])) as unknown[];
        job.status = this.batch.cancelRequestedAt
          ? "cancelled"
          : candidates.length === 0 ? "failed" : candidates.length === 1 ? "resolved" : "ambiguous";
        job.candidates = candidates;
        job.error_code = values[3] === null ? null : String(values[3]);
      }
      return result();
    }
    if (sql.startsWith("UPDATE import_location_staging SET staged_location")) {
      const stagingId = String(values[0]);
      const candidates = JSON.parse(String(values[2])) as unknown[];
      this.stagedLocations.set(stagingId, {
        ...(this.stagedLocations.get(stagingId) ?? {}),
        provider: String(values[1]),
        candidates,
      });
      return result();
    }
    if (sql.startsWith("UPDATE geocoding_job SET status = 'retry_scheduled'")) {
      const job = this.findJob(String(values[0]));
      if (job?.status === "running") {
        job.status = "retry_scheduled";
        job.next_attempt_at = Date.now();
        job.error_code = String(values[2]);
        this.retryDelays.push(Number(values[1]));
      }
      return result();
    }
    if (sql.startsWith("UPDATE geocoding_job SET status = 'failed'")) {
      const job = this.findJob(String(values[0]));
      if (job?.status === "running") {
        job.status = "failed";
        job.error_code = String(values[1]);
      }
      return result();
    }
    if (sql.startsWith("UPDATE geocoding_job SET status = 'cancelled'")) {
      for (const job of this.jobs) {
        if (job.status === "queued" || job.status === "retry_scheduled") {
          job.status = "cancelled";
          job.error_code = "CANCELLED";
          job.next_attempt_at = null;
        }
      }
      return result();
    }
    if (sql.startsWith("SELECT COALESCE(EXTRACT(EPOCH")) {
      const hasRetry = this.jobs.some((job) => job.status === "retry_scheduled");
      return result([{ delay_ms: hasRetry ? 25 : 100 } as T]);
    }
    if (sql.startsWith("SELECT count(*)::integer AS total")) {
      return result([this.counts() as T]);
    }
    if (sql.startsWith("UPDATE geocoding_batch SET status = $2, total_units")) {
      const counts = this.counts();
      this.batch.status = String(values[1]);
      this.batch.total = Number(values[2]);
      this.batch.queued = Number(values[3]);
      this.batch.resolving = Number(values[4]);
      this.batch.resolved = Number(values[5]);
      this.batch.ambiguous = Number(values[6]);
      this.batch.failed = Number(values[7]);
      this.batch.cancelled = Number(values[8]);
      void counts;
      return result();
    }
    if (sql.startsWith("SELECT count(*)::integer AS count FROM import_row")) {
      return result([{ count: this.unresolvedRows } as T]);
    }
    if (sql.startsWith("UPDATE import_job j SET status = $2")) {
      this.importJobStatus = String(values[1]);
      return result();
    }
    throw new Error(`FakeGeocodingDatabase does not recognize query: ${sql}`);
  }

  async transaction<T>(operation: (client: { query: typeof this.query }) => Promise<T>): Promise<T> {
    return operation({ query: this.query.bind(this) });
  }

  async close(): Promise<void> {}

  private findJob(id: string): BatchJobState | undefined {
    return this.jobs.find((job) => job.id === id);
  }

  private counts() {
    return {
      total: this.jobs.length,
      queued: this.jobs.filter((job) => job.status === "queued" || job.status === "retry_scheduled").length,
      resolving: this.jobs.filter((job) => job.status === "running").length,
      resolved: this.jobs.filter((job) => job.status === "resolved").length,
      ambiguous: this.jobs.filter((job) => job.status === "ambiguous").length,
      failed: this.jobs.filter((job) => job.status === "failed").length,
      cancelled: this.jobs.filter((job) => job.status === "cancelled").length,
      cancel_requested_at: this.batch.cancelRequestedAt,
    };
  }
}

function result<T>(rows: T[] = []): { rows: T[]; rowCount: number } {
  return { rows, rowCount: rows.length };
}
