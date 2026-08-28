import { randomUUID } from "node:crypto";

import { PostgresExecutor } from "@on-the-road/database/postgres";
import { fetchExternalMedia, type SafeFetchedMedia, SsrfSafeFetchError } from "@on-the-road/storage";
import { decryptImportMediaUrl } from "../import/media-url-crypto.js";

export type ImportMediaTaskClaim = Readonly<{
  id: string;
  ownerId: string;
  tripId: string;
  importJobId: string;
  itineraryItemId: string;
  status: string;
  version: number;
  leaseToken: string;
  sourceUrlCiphertext: Buffer | string;
  sourceUrlKeyVersion: string;
  sourceUrlExpiresAt: string | null;
  attemptCount: number;
  maxAttempts: number;
}>;

export type ImportMediaTaskRepository = Readonly<{
  claim(id: string, workerId: string, leaseMs: number): Promise<ImportMediaTaskClaim | null>;
  finalizeCancellation(id: string): Promise<boolean>;
  advance(id: string, leaseToken: string, expectedVersion: number, status: string): Promise<boolean>;
  bindAttachment(id: string, leaseToken: string, expectedVersion: number, attachmentId: string): Promise<boolean>;
  markReady(id: string, leaseToken: string, expectedVersion: number, attachmentId: string): Promise<boolean>;
  markFailed(id: string, leaseToken: string, expectedVersion: number, code: string, detail: string): Promise<boolean>;
  scheduleRetry(id: string, leaseToken: string, expectedVersion: number, code: string, nextAttemptAt: Date): Promise<boolean>;
  listRecoverable(limit?: number): Promise<string[]>;
  reconcileParentJob(jobId: string): Promise<string | null>;
  getImportJobId(id: string): Promise<string | null>;
}>;

export interface ImportMediaQuarantineStorage {
  putQuarantine(ownerId: string, value: Buffer, contentType: string): Promise<Readonly<{
    key: string;
    version: string;
    checksumSha256: string;
    contentType: string;
    contentLength: number;
    etag: string;
  }>>;
}

export interface ImportMediaAttachmentFactory {
  create(input: Readonly<{
    id: string;
    task: ImportMediaTaskClaim;
    objectKey: string;
    objectVersion: string;
    etag: string;
    body: SafeFetchedMedia;
  }>): Promise<string>;
}

export class ImportMediaTaskError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "ImportMediaTaskError";
    this.code = code;
    this.retryable = retryable;
  }
}

export class PostgresImportMediaTaskRepository implements ImportMediaTaskRepository {
  readonly #database: PostgresExecutor;

  constructor(options: { databaseUrl?: string; executor?: PostgresExecutor }) {
    this.#database = options.executor ?? new PostgresExecutor({ databaseUrl: options.databaseUrl, role: "worker" });
  }

  async createAttachment(input: Readonly<{
    id: string;
    task: ImportMediaTaskClaim;
    objectKey: string;
    objectVersion: string;
    etag: string;
    body: SafeFetchedMedia;
  }>): Promise<string> {
    await this.#database.query(
      `INSERT INTO attachment (
         id, trip_id, owner_id, object_key, expected_content_type,
         expected_content_length, expected_checksum_sha256, expires_at,
         purpose, itinerary_item_id, import_media_task_id, sort_order, object_version,
         checksum_sha256, content_type, content_length, etag,
         status, completed_at
       ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7,
         now() + interval '30 days', 'media', $8::uuid, $9::uuid,
         COALESCE((SELECT max(sort_order) + 1 FROM attachment WHERE itinerary_item_id = $8::uuid AND deleted_at IS NULL), 0),
         $10, $11, $5, $6, $12, 'uploaded', now())`,
      [input.id, input.task.tripId, input.task.ownerId, input.objectKey,
        input.body.contentType, input.body.contentLength, input.body.checksumSha256Base64,
        input.task.itineraryItemId, input.task.id, input.objectVersion, input.body.checksumSha256Base64, input.etag],
    );
    return input.id;
  }

  async claim(id: string, workerId: string, leaseMs: number): Promise<ImportMediaTaskClaim | null> {
    const result = await this.#database.json<ImportMediaTaskClaim | null>(
      `WITH claimed AS (
         UPDATE import_media_task
         SET status = 'fetching', lease_owner = $2, lease_token = gen_random_uuid(),
             lease_expires_at = now() + ($3::integer * interval '1 millisecond'),
             attempt_count = attempt_count + 1, lifetime_attempt_count = lifetime_attempt_count + 1,
             version = version + 1, updated_at = now()
       WHERE id = $1::uuid
           AND (
             status IN ('approved', 'queued', 'retry_scheduled')
             OR (status IN ('fetching', 'quarantined', 'scanning', 'processing')
                 AND lease_expires_at < now())
           )
           AND (next_attempt_at IS NULL OR next_attempt_at <= now())
         RETURNING *
       )
       SELECT COALESCE((SELECT jsonb_build_object(
         'id', id, 'ownerId', owner_id, 'tripId', trip_id, 'importJobId', import_job_id,
         'itineraryItemId', itinerary_item_id, 'status', status, 'version', version,
         'attachmentId', attachment_id,
         'leaseToken', lease_token,
         'sourceUrlCiphertext', encode(source_url_ciphertext, 'base64'),
         'sourceUrlKeyVersion', source_url_key_version,
         'sourceUrlExpiresAt', source_url_expires_at,
         'attemptCount', attempt_count, 'maxAttempts', max_attempts
       ) FROM claimed), 'null'::jsonb)::text`,
      [id, workerId, leaseMs],
    );
    return result;
  }

  async finalizeCancellation(id: string): Promise<boolean> {
    const result = await this.#database.query(
      `UPDATE import_media_task
       SET status = 'cancelled', completed_at = COALESCE(completed_at, now()),
           updated_at = now(), version = version + 1
       WHERE id = $1::uuid AND status = 'cancelling'`,
      [id],
    );
    return result.rowCount === 1;
  }

  async advance(id: string, leaseToken: string, expectedVersion: number, status: string): Promise<boolean> {
    const result = await this.#database.query(
      `UPDATE import_media_task
       SET status = $4,
           version = version + 1, updated_at = now()
       WHERE id = $1::uuid AND lease_token = $2::uuid AND version = $3
         AND lease_expires_at > now()
         AND status IN ('fetching', 'quarantined', 'scanning', 'processing')`,
      [id, leaseToken, expectedVersion, status],
    );
    return result.rowCount === 1;
  }

  async bindAttachment(id: string, leaseToken: string, expectedVersion: number, attachmentId: string): Promise<boolean> {
    const result = await this.#database.query(
      `UPDATE import_media_task
       SET attachment_id = $4::uuid, version = version + 1, updated_at = now()
       WHERE id = $1::uuid AND lease_token = $2::uuid AND version = $3
         AND lease_expires_at > now() AND status = 'processing'`,
      [id, leaseToken, expectedVersion, attachmentId],
    );
    return result.rowCount === 1;
  }

  async markReady(id: string, leaseToken: string, expectedVersion: number, attachmentId: string): Promise<boolean> {
    const result = await this.#database.query(
      `UPDATE import_media_task
       SET status = 'ready', attachment_id = $4::uuid,
           error_code = NULL, error_detail = NULL, next_attempt_at = NULL,
           lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
           completed_at = now(), version = version + 1, updated_at = now()
       WHERE id = $1::uuid AND lease_token = $2::uuid AND version = $3
         AND lease_expires_at > now()
         AND status = 'processing'`,
      [id, leaseToken, expectedVersion, attachmentId],
    );
    return result.rowCount === 1;
  }

  async markFailed(id: string, leaseToken: string, expectedVersion: number, code: string, detail: string): Promise<boolean> {
    const result = await this.#database.query(
      `UPDATE import_media_task
       SET status = 'failed', error_code = $4, error_detail = $5,
           lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
           completed_at = now(), version = version + 1, updated_at = now()
       WHERE id = $1::uuid AND lease_token = $2::uuid AND version = $3
         AND lease_expires_at > now()
         AND status IN ('fetching', 'quarantined', 'scanning', 'processing')`,
      [id, leaseToken, expectedVersion, code, detail.slice(0, 2000)],
    );
    return result.rowCount === 1;
  }

  async scheduleRetry(id: string, leaseToken: string, expectedVersion: number, code: string, nextAttemptAt: Date): Promise<boolean> {
    const result = await this.#database.query(
      `UPDATE import_media_task
       SET status = 'retry_scheduled', error_code = $4,
           next_attempt_at = $5::timestamptz,
           lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
           retry_generation = retry_generation + 1,
           version = version + 1, updated_at = now()
       WHERE id = $1::uuid AND lease_token = $2::uuid AND version = $3
         AND lease_expires_at > now()
         AND status IN ('fetching', 'quarantined', 'scanning', 'processing')`,
      [id, leaseToken, expectedVersion, code, nextAttemptAt],
    );
    return result.rowCount === 1;
  }

  async listRecoverable(limit = 100): Promise<string[]> {
    const result = await this.#database.query<{ id: string }>(
      `SELECT id
       FROM import_media_task
       WHERE status IN ('approved', 'queued', 'retry_scheduled', 'cancelling')
          OR (status IN ('fetching', 'quarantined', 'scanning', 'processing')
              AND lease_expires_at < now())
       ORDER BY updated_at, id LIMIT $1`,
      [limit],
    );
    return result.rows.map(({ id }) => id);
  }

  async reconcileParentJob(jobId: string): Promise<string | null> {
    const result = await this.#database.query<{ status: string | null }>(
      `WITH counts AS (
         SELECT
           count(*) FILTER (WHERE status NOT IN ('ready', 'failed', 'rejected', 'cancelled')) AS pending,
           count(*) FILTER (WHERE status IN ('failed', 'rejected')) AS failed,
           count(*) AS total
         FROM import_media_task WHERE import_job_id = $1::uuid
       ), updated AS (
         UPDATE import_job j
         SET status = CASE
               WHEN j.status = 'cancelling' AND counts.pending = 0 THEN 'cancelled'
               WHEN j.status IN ('processing_media', 'importing') AND counts.pending = 0
                 THEN CASE WHEN counts.failed > 0 OR j.error_rows > 0
                   THEN 'completed_with_warnings' ELSE 'completed' END
               ELSE j.status
             END,
             stage = CASE
               WHEN j.status = 'cancelling' AND counts.pending = 0 THEN 'cancelled'
               WHEN j.status IN ('processing_media', 'importing') AND counts.pending = 0 THEN 'completed'
               ELSE j.stage
             END,
             completed_at = CASE
               WHEN counts.pending = 0 AND j.status IN ('processing_media', 'importing', 'cancelling')
                 THEN COALESCE(j.completed_at, now())
               ELSE j.completed_at
             END,
             updated_at = now()
         FROM counts
         WHERE j.id = $1::uuid
         RETURNING j.status
       )
       SELECT (SELECT status FROM updated) AS status`,
      [jobId],
    );
    return result.rows[0]?.status ?? null;
  }

  async getImportJobId(id: string): Promise<string | null> {
    const result = await this.#database.query<{ import_job_id: string | null }>(
      `SELECT import_job_id::text AS import_job_id
       FROM import_media_task
       WHERE id = $1::uuid`,
      [id],
    );
    return result.rows[0]?.import_job_id ?? null;
  }

  close(): Promise<void> { return this.#database.close(); }
}

export class ImportMediaTaskProcessor {
  readonly #repository: ImportMediaTaskRepository;
  readonly #storage: ImportMediaQuarantineStorage;
  readonly #attachments: ImportMediaAttachmentFactory;
  readonly #mediaSecret: string;
  readonly #mediaKeyVersion: string;
  readonly #workerId: string;
  readonly #fetch: typeof fetch;
  readonly #lookup?: NonNullable<Parameters<typeof fetchExternalMedia>[1]>["lookup"];
  readonly #maximumBytes: number;
  readonly #now: () => Date;
  readonly #processAttachment?: (attachmentId: string) => Promise<unknown>;

  constructor(options: {
    repository: ImportMediaTaskRepository;
    storage: ImportMediaQuarantineStorage;
    attachments: ImportMediaAttachmentFactory;
    mediaSecret: string;
    mediaKeyVersion?: string;
    workerId?: string;
    fetch?: typeof fetch;
    lookup?: NonNullable<Parameters<typeof fetchExternalMedia>[1]>["lookup"];
    maximumBytes?: number;
    now?: () => Date;
    processAttachment?: (attachmentId: string) => Promise<unknown>;
  }) {
    this.#repository = options.repository;
    this.#storage = options.storage;
    this.#attachments = options.attachments;
    this.#mediaSecret = options.mediaSecret;
    this.#mediaKeyVersion = options.mediaKeyVersion ?? "runtime-v1";
    this.#workerId = options.workerId ?? randomUUID();
    this.#fetch = options.fetch ?? fetch;
    this.#lookup = options.lookup;
    this.#maximumBytes = options.maximumBytes ?? 20 * 1024 * 1024;
    this.#now = options.now ?? (() => new Date());
    if (options.processAttachment) this.#processAttachment = options.processAttachment;
  }

  async process(id: string): Promise<"ready" | "failed" | "retry_scheduled" | "cancelled" | "fenced" | "not_claimable"> {
    if (await this.#repository.finalizeCancellation(id)) return "cancelled";
      const task = await this.#repository.claim(id, this.#workerId, 60_000);
    if (!task) return "not_claimable";
    let version = task.version;
    try {
      const ciphertext = typeof task.sourceUrlCiphertext === "string"
        ? Buffer.from(task.sourceUrlCiphertext, "base64")
        : task.sourceUrlCiphertext;
      if (task.sourceUrlExpiresAt && Date.parse(task.sourceUrlExpiresAt) <= this.#now().getTime()) {
        throw new TypeError("Import media URL ciphertext expired");
      }
      if (task.sourceUrlKeyVersion !== this.#mediaKeyVersion) {
        throw new ImportMediaTaskError("MEDIA_URL_KEY_VERSION_UNSUPPORTED", "The encrypted media URL key version is not supported.");
      }
      const url = decryptImportMediaUrl(ciphertext, this.#mediaSecret);
      const fetched = await fetchExternalMedia(url, {
        fetch: this.#fetch,
        ...(this.#lookup ? { lookup: this.#lookup } : {}),
        maximumBytes: this.#maximumBytes,
      });
      if (!await this.#repository.advance(id, task.leaseToken, version, "quarantined")) return "fenced";
      version += 1;
      const quarantine = await this.#storage.putQuarantine(task.ownerId, fetched.body, fetched.contentType);
      if (!await this.#repository.advance(id, task.leaseToken, version, "scanning")) return "fenced";
      version += 1;
      if (!await this.#repository.advance(id, task.leaseToken, version, "processing")) return "fenced";
      version += 1;
      const attachmentId = await this.#attachments.create({
        id: randomUUID(),
        task,
        objectKey: quarantine.key,
        objectVersion: quarantine.version,
        etag: quarantine.etag,
        body: fetched,
      });
      if (!await this.#repository.bindAttachment(id, task.leaseToken, version, attachmentId)) return "fenced";
      version += 1;
      if (this.#processAttachment) await this.#processAttachment(attachmentId);
      return await this.#repository.markReady(id, task.leaseToken, version, attachmentId)
        ? "ready"
        : "fenced";
    } catch (error) {
      const code = error instanceof TypeError
        ? "MEDIA_URL_EXPIRED"
        : error instanceof ImportMediaTaskError ? error.code
        : error instanceof SsrfSafeFetchError ? error.code : "MEDIA_IMPORT_FAILED";
      const retryable = error instanceof SsrfSafeFetchError && error.status >= 500;
      if (retryable && task.attemptCount < task.maxAttempts) {
        const nextAttemptAt = new Date(this.#now().getTime() + 1_000);
        return await this.#repository.scheduleRetry(id, task.leaseToken, version, code, nextAttemptAt)
          ? "retry_scheduled"
          : "fenced";
      }
      const finalCode = retryable ? "MEDIA_RETRY_EXHAUSTED" : code;
      return await this.#repository.markFailed(id, task.leaseToken, version, finalCode, error instanceof Error ? error.message : finalCode)
        ? "failed"
        : "fenced";
    }
  }
}
