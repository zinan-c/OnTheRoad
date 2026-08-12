export class ImportMediaTaskError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] */
  constructor(code, message, status = 409) {
    super(message);
    this.name = "ImportMediaTaskError";
    this.code = code;
    this.status = status;
  }
}

export class PostgresImportMediaTaskService {
  /** @param {{database: import("@on-the-road/database/postgres").PostgresExecutor, queue?: any}} options */
  constructor({ database, queue }) {
    this.database = database;
    this.queue = queue;
  }

  /** @param {string} ownerId @param {string} jobId */
  list(ownerId, jobId) {
    return this.database.json(
      `SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', m.id, 'tripId', m.trip_id, 'importJobId', m.import_job_id,
        'importRowId', m.import_row_id, 'sourceRowKey', m.source_row_key,
        'itineraryItemId', m.itinerary_item_id, 'attachmentId', m.attachment_id,
        'urlOrdinal', m.url_ordinal, 'sourceUrlSha256', m.source_url_sha256,
        'status', m.status, 'decisionBy', m.decision_by,
        'decidedAt', m.decided_at, 'attemptCount', m.attempt_count,
        'lifetimeAttemptCount', m.lifetime_attempt_count,
        'retryGeneration', m.retry_generation, 'nextAttemptAt', m.next_attempt_at,
        'errorCode', m.error_code, 'errorDetail', m.error_detail,
        'createdAt', m.created_at, 'updatedAt', m.updated_at,
        'completedAt', m.completed_at
      ) ORDER BY m.source_row_key, m.url_ordinal, m.id), '[]'::jsonb)::text
       FROM import_media_task m
       JOIN import_job j ON j.id = m.import_job_id
       WHERE j.id = $2::uuid AND j.owner_id = $1`,
      [ownerId, jobId],
    ).then((/** @type {any[]} */ tasks) => {
      if (tasks.length === 0) return this.#assertJob(ownerId, jobId).then(() => tasks);
      return tasks;
    });
  }

  /** @param {string} ownerId @param {string} jobId @param {string} taskId */
  async approve(ownerId, jobId, taskId) {
    const result = await this.database.json(
      `UPDATE import_media_task m
       SET status = CASE
             WHEN j.status = 'processing_media' AND m.itinerary_item_id IS NOT NULL THEN 'queued'
             ELSE 'approved'
           END,
           decision_by = $1, decided_at = now(),
           error_code = NULL, error_detail = NULL, updated_at = now(), version = version + 1
       FROM import_job j
       WHERE m.id = $3::uuid AND m.import_job_id = j.id
         AND j.id = $2::uuid AND j.owner_id = $1
         AND j.status IN ('confirmation_required', 'ready_to_import', 'importing', 'processing_media')
         AND m.status = 'awaiting_approval'
       RETURNING jsonb_build_object(
         'id', m.id, 'status', m.status, 'decisionBy', m.decision_by,
         'decidedAt', m.decided_at, 'retryGeneration', m.retry_generation
       )::text`,
      [ownerId, jobId, taskId],
    );
    if (!result) throw new ImportMediaTaskError("IMPORT_MEDIA_TASK_NOT_APPROVABLE", "The media task is not awaiting approval.");
    if (result.status === "queued") {
      await this.queue?.lpush("otr:media", JSON.stringify({ mediaTaskId: taskId, jobId }));
    }
    return result;
  }

  /** @param {string} ownerId @param {string} jobId @param {string} taskId @param {{reason?: string}} [input] */
  async reject(ownerId, jobId, taskId, input = {}) {
    const reason = input.reason?.trim() || "rejected by user";
    const result = await this.database.json(
      `UPDATE import_media_task m
       SET status = 'rejected', decision_by = $1, decided_at = now(),
           error_code = 'MEDIA_REJECTED', error_detail = $4,
           completed_at = now(), updated_at = now(), version = version + 1
       FROM import_job j
       WHERE m.id = $3::uuid AND m.import_job_id = j.id
         AND j.id = $2::uuid AND j.owner_id = $1
         AND m.status = 'awaiting_approval'
       RETURNING jsonb_build_object(
         'id', m.id, 'status', m.status, 'decisionBy', m.decision_by,
         'decidedAt', m.decided_at, 'errorCode', m.error_code,
         'errorDetail', m.error_detail
       )::text`,
      [ownerId, jobId, taskId, reason],
    );
    if (!result) throw new ImportMediaTaskError("IMPORT_MEDIA_TASK_NOT_REJECTABLE", "The media task is not awaiting approval.");
    await this.#reconcile(ownerId, jobId);
    return result;
  }

  /** @param {string} ownerId @param {string} jobId @param {string} taskId */
  async retry(ownerId, jobId, taskId) {
    const result = await this.database.json(
      `UPDATE import_media_task m
       SET status = CASE WHEN m.itinerary_item_id IS NULL THEN 'approved' ELSE 'queued' END,
           attempt_count = 0, retry_generation = retry_generation + 1,
           next_attempt_at = NULL, error_code = NULL, error_detail = NULL,
           completed_at = NULL, updated_at = now(), version = version + 1
       FROM import_job j
       WHERE m.id = $3::uuid AND m.import_job_id = j.id
         AND j.id = $2::uuid AND j.owner_id = $1
         AND m.status = 'failed'
         AND m.source_url_expires_at > now()
       RETURNING jsonb_build_object(
         'id', m.id, 'status', m.status, 'retryGeneration', m.retry_generation
       )::text`,
      [ownerId, jobId, taskId],
    );
    if (!result) {
      const expired = await this.database.json(
        `SELECT EXISTS(
          SELECT 1 FROM import_media_task m JOIN import_job j ON j.id = m.import_job_id
          WHERE m.id = $3::uuid AND j.id = $2::uuid AND j.owner_id = $1
            AND m.source_url_expires_at <= now()
        )::text`,
        [ownerId, jobId, taskId],
      );
      if (expired) throw new ImportMediaTaskError("IMPORT_MEDIA_SOURCE_EXPIRED", "The encrypted media URL has expired.", 410);
      throw new ImportMediaTaskError("IMPORT_MEDIA_TASK_NOT_RETRYABLE", "The media task cannot be retried.");
    }
    if (result.status === "queued") {
      await this.queue?.lpush("otr:media", JSON.stringify({ mediaTaskId: taskId, jobId }));
    }
    return result;
  }

  /** @param {string} ownerId @param {string} jobId @param {string} taskId */
  async cancel(ownerId, jobId, taskId) {
    const result = await this.database.json(
      `UPDATE import_media_task m
       SET status = 'cancelled', cancelled_by = $1, cancelled_actor = $1,
           cancelled_at = now(), completed_at = now(),
           lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
           updated_at = now(), version = version + 1
       FROM import_job j
       WHERE m.id = $3::uuid AND m.import_job_id = j.id
         AND j.id = $2::uuid AND j.owner_id = $1
         AND m.status NOT IN ('ready', 'failed', 'rejected', 'cancelled')
       RETURNING jsonb_build_object('id', m.id, 'status', m.status)::text`,
      [ownerId, jobId, taskId],
    );
    if (!result) throw new ImportMediaTaskError("IMPORT_MEDIA_TASK_NOT_CANCELLABLE", "The media task cannot be cancelled.");
    await this.#reconcile(ownerId, jobId);
    return result;
  }

  /** @param {string} ownerId @param {string} jobId */
  async #assertJob(ownerId, jobId) {
    const job = await this.database.json(
      `SELECT EXISTS(SELECT 1 FROM import_job WHERE id = $2::uuid AND owner_id = $1)::text`,
      [ownerId, jobId],
    );
    if (!job) throw new ImportMediaTaskError("IMPORT_JOB_NOT_FOUND", "Import job was not found.", 404);
  }

  /** @param {string} ownerId @param {string} jobId */
  async #reconcile(ownerId, jobId) {
    await this.database.query(
      `WITH counts AS (
         SELECT count(*) FILTER (WHERE status NOT IN ('ready','failed','rejected','cancelled')) AS pending,
                count(*) FILTER (WHERE status IN ('failed','rejected')) AS warnings
         FROM import_media_task m WHERE m.import_job_id = $2::uuid
       )
       UPDATE import_job j
       SET status = CASE WHEN counts.pending = 0 AND j.status IN ('processing_media','cancelling')
                  THEN CASE WHEN j.status = 'cancelling' THEN 'cancelled'
                            WHEN counts.warnings > 0 OR j.error_rows > 0 THEN 'completed_with_warnings'
                            ELSE 'completed' END
                  ELSE j.status END,
           stage = CASE WHEN counts.pending = 0 AND j.status IN ('processing_media','cancelling') THEN 'completed' ELSE j.stage END,
           completed_at = CASE WHEN counts.pending = 0 AND j.status IN ('processing_media','cancelling') THEN COALESCE(j.completed_at, now()) ELSE j.completed_at END,
           updated_at = now()
       FROM counts
       WHERE j.id = $2::uuid AND j.owner_id = $1`,
      [ownerId, jobId],
    );
  }
}
