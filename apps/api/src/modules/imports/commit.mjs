import { randomUUID } from "node:crypto";

import {
  assertImportCommitCanStart,
  assertImportCommitCancelable,
  importOverrideScope,
} from "@on-the-road/application/import/commit";

export class ImportCommitError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] */
  constructor(code, message, status = 409) {
    super(message);
    this.name = "ImportCommitError";
    this.code = code;
    this.status = status;
  }
}

export class PostgresImportCommitTransport {
  /** @param {{database: import("@on-the-road/database/postgres").PostgresExecutor, queue?: any, idFactory?: () => string}} options */
  constructor({ database, queue, idFactory = randomUUID }) {
    this.database = database;
    this.queue = queue;
    this.idFactory = idFactory;
  }

  /** @param {string} ownerId @param {string} jobId */
  async getCommitJob(ownerId, jobId) {
    const job = await this.database.json(
      `SELECT COALESCE((
        SELECT jsonb_build_object(
          'id', j.id, 'tripId', j.trip_id, 'ownerId', j.owner_id,
          'status', j.status, 'stage', j.stage,
          'totalRows', j.total_rows, 'validRows', j.valid_rows,
          'errorRows', j.error_rows, 'committedRows', j.committed_rows,
          'importedRows', j.imported_rows,
          'resumedFromJobId', j.resumed_from_job_id,
          'cancelRequestedAt', j.cancel_requested_at,
          'updatedAt', j.updated_at, 'completedAt', j.completed_at
        )
        FROM import_job j
        WHERE j.id = $2::uuid AND j.owner_id = $1
      ), 'null'::jsonb)::text`,
      [ownerId, jobId],
    );
    if (!job) throw new ImportCommitError("IMPORT_JOB_NOT_FOUND", "Import job was not found.", 404);
    return job;
  }

  /** @param {string} ownerId @param {string} jobId @param {{idempotencyKey?: string}} [input] */
  async startCommit(ownerId, jobId, input = {}) {
    const queued = await this.database.transaction(async (client) => {
      const current = (await client.query(
        `SELECT id, trip_id, owner_id, status
         FROM import_job
         WHERE id = $1::uuid AND owner_id = $2
         FOR UPDATE`,
        [jobId, ownerId],
      )).rows[0];
      if (!current) throw new ImportCommitError("IMPORT_JOB_NOT_FOUND", "Import job was not found.", 404);
      assertImportCommitCanStart(current.status);
      if (current.status === "importing") return false;
      const idempotencyKey = String(input.idempotencyKey ?? `commit:${jobId}`);
      if (idempotencyKey.length < 1 || idempotencyKey.length > 255) {
        throw new ImportCommitError("IMPORT_IDEMPOTENCY_KEY_INVALID", "The idempotency key is invalid.", 422);
      }
      await client.query(
        `UPDATE import_job
         SET status = 'importing', stage = 'importing',
             idempotency_key = COALESCE(idempotency_key, $2),
             updated_at = now()
         WHERE id = $1::uuid`,
        [jobId, idempotencyKey],
      );
      return true;
    });
    if (queued) {
      await this.queue?.lpush("otr:import-commit", JSON.stringify({ jobId }));
    }
    return this.getCommitJob(ownerId, jobId);
  }

  /** @param {string} ownerId @param {string} jobId */
  async cancelCommit(ownerId, jobId) {
    const result = await this.database.transaction(async (client) => {
      const current = (await client.query(
        `SELECT id, status,
                EXISTS(
                  SELECT 1 FROM import_media_task m
                  WHERE m.import_job_id = import_job.id
                    AND m.status IN ('fetching', 'quarantined', 'scanning', 'processing', 'cancelling')
                ) AS has_active_media
         FROM import_job
         WHERE id = $1::uuid AND owner_id = $2
         FOR UPDATE`,
        [jobId, ownerId],
      )).rows[0];
      if (!current) throw new ImportCommitError("IMPORT_JOB_NOT_FOUND", "Import job was not found.", 404);
      assertImportCommitCancelable(current.status);
      if (current.status === "cancelled") return false;
      if (current.status === "cancelling") return true;
      const hasActiveMedia = current.has_active_media === true;
      const needsCommitCheckpoint = current.status === "importing";
      const needsAsyncCheckpoint = hasActiveMedia || needsCommitCheckpoint;
      await client.query(
        `UPDATE import_job
         SET status = CASE WHEN $3::boolean THEN 'cancelling' ELSE 'cancelled' END,
             stage = CASE WHEN $3::boolean THEN 'importing' ELSE 'completed' END,
             cancel_requested_at = now(), cancel_requested_by = $2,
             completed_at = CASE WHEN $3::boolean THEN completed_at ELSE now() END,
             updated_at = now()
         WHERE id = $1::uuid`,
        [jobId, ownerId, needsAsyncCheckpoint],
      );
      await client.query(
        `UPDATE import_media_task
         SET status = CASE
               WHEN status IN ('awaiting_approval', 'approved', 'queued', 'retry_scheduled')
                 THEN 'cancelled'
               WHEN status IN ('fetching', 'quarantined', 'scanning', 'processing')
                 THEN 'cancelling'
               ELSE status
             END,
             cancelled_by = CASE
               WHEN status IN ('awaiting_approval', 'approved', 'queued', 'retry_scheduled')
                 THEN $2 ELSE cancelled_by END,
             cancelled_actor = CASE
               WHEN status IN ('awaiting_approval', 'approved', 'queued', 'retry_scheduled')
                 THEN $2 ELSE cancelled_actor END,
             cancelled_at = CASE
               WHEN status IN ('awaiting_approval', 'approved', 'queued', 'retry_scheduled')
                 THEN now() ELSE cancelled_at END,
             lease_owner = CASE
               WHEN status IN ('fetching', 'quarantined', 'scanning', 'processing')
                 THEN NULL ELSE lease_owner END,
             lease_token = CASE
               WHEN status IN ('fetching', 'quarantined', 'scanning', 'processing')
                 THEN NULL ELSE lease_token END,
             lease_expires_at = CASE
               WHEN status IN ('fetching', 'quarantined', 'scanning', 'processing')
                 THEN NULL ELSE lease_expires_at END,
             version = version + 1, updated_at = now()
         WHERE import_job_id = $1::uuid
           AND status NOT IN ('ready', 'failed', 'rejected', 'cancelled')`,
        [jobId, ownerId],
      );
      return needsAsyncCheckpoint;
    });
    if (result) await this.queue?.lpush("otr:import-commit", JSON.stringify({ jobId }));
    return this.getCommitJob(ownerId, jobId);
  }

  /** @param {string} ownerId @param {string} jobId */
  async resumeCommit(ownerId, jobId) {
    const resumedJobId = await this.database.transaction(async (client) => {
      const source = (await client.query(
        `SELECT * FROM import_job
         WHERE id = $1::uuid AND owner_id = $2
         FOR UPDATE`,
        [jobId, ownerId],
      )).rows[0];
      if (!source) throw new ImportCommitError("IMPORT_JOB_NOT_FOUND", "Import job was not found.", 404);
      if (source.status !== "cancelled") {
        throw new ImportCommitError("IMPORT_RESUME_REQUIRES_CANCELLED", "Only a cancelled import can be resumed.");
      }
      const id = this.idFactory();
      await client.query(
        `INSERT INTO import_job (
           id, trip_id, owner_id, resumed_from_job_id, source_attachment_id,
           source_sha256, importer_type, importer_version, mapping, mapping_hash,
           mapping_version, status, stage, total_rows, valid_rows, error_rows
         ) VALUES (
           $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid,
           $6, $7, $8, $9::jsonb, $10, $11,
           'importing', 'importing', $12, $13, $14
         )`,
        [id, source.trip_id, ownerId, source.id, source.source_attachment_id,
          source.source_sha256, source.importer_type, source.importer_version,
          JSON.stringify(source.mapping), source.mapping_hash, source.mapping_version,
          source.total_rows, source.valid_rows, source.error_rows],
      );
      await client.query(
        `INSERT INTO import_row (
           import_job_id, sheet_name, row_number, source_row_key, raw_data,
           normalized_data, fingerprint, status, errors, staged_location,
           imported_item_id, decision_scope, override_decision_id, override_reason
         )
         SELECT $1::uuid, sheet_name, row_number, source_row_key, raw_data,
           normalized_data, fingerprint,
           CASE WHEN status IN ('new', 'update', 'duplicate', 'ready', 'imported')
             THEN CASE WHEN status = 'imported' THEN 'ready' ELSE status END
             ELSE status END,
           errors, staged_location, imported_item_id, decision_scope,
           override_decision_id, override_reason
         FROM import_row
         WHERE import_job_id = $2::uuid
           AND status NOT IN ('skipped', 'error', 'unresolved')`,
        [id, jobId],
      );
      await client.query(
        `INSERT INTO import_media_task (
           trip_id, owner_id, import_job_id, import_row_id, source_row_key,
           itinerary_item_id, url_ordinal, source_url_sha256, source_url_ciphertext,
           source_url_key_version, source_url_expires_at, status,
           decision_by, decided_at, attempt_count, lifetime_attempt_count,
           retry_generation, max_attempts, error_code, error_detail
         )
         SELECT m.trip_id, m.owner_id, $1::uuid, r.id, m.source_row_key,
           m.itinerary_item_id, m.url_ordinal, m.source_url_sha256, m.source_url_ciphertext,
           m.source_url_key_version, m.source_url_expires_at,
           CASE WHEN m.status IN ('approved', 'retry_scheduled') THEN m.status ELSE 'awaiting_approval' END,
           CASE WHEN m.status IN ('approved', 'retry_scheduled') THEN m.decision_by ELSE NULL END,
           CASE WHEN m.status IN ('approved', 'retry_scheduled') THEN m.decided_at ELSE NULL END,
           0, m.lifetime_attempt_count, m.retry_generation, m.max_attempts,
           CASE WHEN m.status IN ('approved', 'retry_scheduled') THEN m.error_code ELSE NULL END,
           CASE WHEN m.status IN ('approved', 'retry_scheduled') THEN m.error_detail ELSE NULL END
         FROM import_media_task m
         JOIN import_row r ON r.import_job_id = $1::uuid AND r.source_row_key = m.source_row_key
         WHERE m.import_job_id = $2::uuid
           AND m.status IN ('awaiting_approval', 'approved', 'retry_scheduled')`,
        [id, jobId],
      );
      return id;
    });
    await this.queue?.lpush("otr:import-commit", JSON.stringify({ jobId: resumedJobId }));
    return this.getCommitJob(ownerId, resumedJobId);
  }

  /** @param {string} ownerId @param {string} jobId @param {{rowId: string, reason: string}} input */
  async createOverrideDecision(ownerId, jobId, input) {
    if (!input.reason?.trim()) throw new ImportCommitError("IMPORT_OVERRIDE_REASON_REQUIRED", "An override reason is required.", 422);
    const decision = await this.database.json(
      `INSERT INTO import_override_decision (
         trip_id, owner_id, import_job_id, import_row_id,
         decision_type, reason, actor_id
       )
       SELECT j.trip_id, j.owner_id, j.id, r.id,
         'duplicate_insert', $4, $1
       FROM import_job j
       JOIN import_row r ON r.import_job_id = j.id AND r.id = $3::uuid
       WHERE j.id = $2::uuid AND j.owner_id = $1
       RETURNING jsonb_build_object(
         'id', id, 'importJobId', import_job_id, 'importRowId', import_row_id,
         'decisionType', decision_type, 'reason', reason, 'actorId', actor_id,
         'consumedAt', consumed_at
       )::text`,
      [ownerId, jobId, input.rowId, input.reason.trim()],
    );
    if (!decision) throw new ImportCommitError("IMPORT_ROW_NOT_FOUND", "Import row was not found.", 404);
    await this.database.query(
      `UPDATE import_row
       SET decision_scope = $4, override_decision_id = $3::uuid,
           override_reason = $5, status = CASE WHEN status = 'duplicate' THEN 'ready' ELSE status END,
           updated_at = now()
       WHERE id = $1::uuid AND import_job_id = $2::uuid`,
      [input.rowId, jobId, decision.id, importOverrideScope(decision.id), input.reason.trim()],
    );
    return decision;
  }
}
