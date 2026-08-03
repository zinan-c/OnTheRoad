export class ImportPreviewError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] */
  constructor(code, message, status = 400) { super(message); this.name = "ImportPreviewError"; this.code = code; this.status = status; }
}

export class PostgresImportPreviewRepository {
  /** @param {{executor: any}} options */
  constructor({ executor }) { this.database = executor; }
  /** @param {string} ownerId @param {string} jobId */
  async job(ownerId, jobId) {
    const job = await this.database.json(`SELECT COALESCE((SELECT jsonb_build_object('id', id, 'tripId', trip_id, 'ownerId', owner_id, 'status', status, 'stage', stage, 'totalRows', total_rows, 'validRows', valid_rows, 'errorRows', error_rows, 'importedRows', imported_rows, 'mappingVersion', mapping_version, 'updatedAt', updated_at) FROM import_job WHERE id = $2::uuid AND owner_id = $1), 'null'::jsonb)::text`, [ownerId, jobId]);
    if (!job) throw new ImportPreviewError("IMPORT_JOB_NOT_FOUND", "Import job was not found.", 404);
    return job;
  }
  /** @param {string} ownerId @param {string} jobId */
  rows(ownerId, jobId) { return this.database.json(`SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'sheetName', r.sheet_name, 'rowNumber', r.row_number, 'sourceRowKey', r.source_row_key, 'status', r.status, 'rawData', r.raw_data, 'normalizedData', r.normalized_data, 'errors', r.errors) ORDER BY r.row_number, r.id), '[]'::jsonb) FROM import_row r JOIN import_job j ON j.id = r.import_job_id WHERE j.id = $2::uuid AND j.owner_id = $1 AND r.status <> 'pending'`, [ownerId, jobId]); }
  /** @param {string} ownerId @param {string} jobId @param {string[]} ids */
  skip(ownerId, jobId, ids) { return this.database.json(`UPDATE import_row r SET status = 'skipped', updated_at = now() FROM import_job j WHERE j.id = r.import_job_id AND j.id = $2::uuid AND j.owner_id = $1 AND r.id = ANY($3::uuid[]) AND r.status IN ('error', 'unresolved') RETURNING r.id`, [ownerId, jobId, ids]); }
}

export class ImportPreviewService {
  /** @param {any} repository */
  constructor(repository) { this.repository = repository; }
  /** @param {string} ownerId @param {string} jobId */
  async list(ownerId, jobId) { const job = await this.repository.job(ownerId, jobId); return { job, rows: await this.repository.rows(ownerId, jobId) }; }
  /** @param {string} ownerId @param {string} jobId @param {string[]} ids */
  async skip(ownerId, jobId, ids) { await this.repository.job(ownerId, jobId); return { jobId, skipped: await this.repository.skip(ownerId, jobId, ids) }; }
}
