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
  /** @param {string} ownerId @param {string} jobId @param {{status?: string, query?: string, page: number, pageSize: number}} filters */
  rows(ownerId, jobId, filters) { return this.database.json(`
    WITH owned AS (
      SELECT r.*
      FROM import_row r
      JOIN import_job j ON j.id = r.import_job_id
      WHERE j.id = $2::uuid AND j.owner_id = $1 AND r.status <> 'pending'
    ), counts AS (
      SELECT status, count(*)::integer AS count FROM owned GROUP BY status
    ), filtered AS (
      SELECT * FROM owned
      WHERE ($3 = '' OR status = $3)
        AND ($4 = '' OR sheet_name ILIKE '%' || $4 || '%'
          OR source_row_key ILIKE '%' || $4 || '%'
          OR raw_data::text ILIKE '%' || $4 || '%')
    ), page_rows AS (
      SELECT * FROM filtered
      ORDER BY sheet_name, row_number, id
      LIMIT $5 OFFSET (($6 - 1) * $5)
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'sheetName', r.sheet_name, 'rowNumber', r.row_number,
        'sourceRowKey', r.source_row_key, 'status', r.status,
        'rawData', r.raw_data, 'normalizedData', r.normalized_data,
        'errors', r.errors
      ) ORDER BY r.sheet_name, r.row_number, r.id) FROM page_rows r), '[]'::jsonb),
      'counts', jsonb_build_object(
        'total', (SELECT count(*) FROM owned),
        'new', COALESCE((SELECT count FROM counts WHERE status = 'new'), 0),
        'update', COALESCE((SELECT count FROM counts WHERE status = 'update'), 0),
        'duplicate', COALESCE((SELECT count FROM counts WHERE status = 'duplicate'), 0),
        'error', COALESCE((SELECT count FROM counts WHERE status = 'error'), 0),
        'unresolved', COALESCE((SELECT count FROM counts WHERE status = 'unresolved'), 0),
        'skipped', COALESCE((SELECT count FROM counts WHERE status = 'skipped'), 0)
      ),
      'filteredTotal', (SELECT count(*) FROM filtered),
      'page', $6,
      'pageSize', $5,
      'totalPages', GREATEST(1, CEIL((SELECT count(*) FROM filtered)::numeric / $5)::integer)
    )
  `, [ownerId, jobId, filters.status ?? "", filters.query ?? "", filters.pageSize, filters.page]); }
  /** @param {string} ownerId @param {string} jobId @param {string[]} ids */
  skip(ownerId, jobId, ids) {
    return this.database.json(`
      WITH skipped AS (
        UPDATE import_row r
        SET status = 'skipped', updated_at = now()
        FROM import_job j
        WHERE j.id = r.import_job_id
          AND j.id = $2::uuid
          AND j.owner_id = $1
          AND r.id = ANY($3::uuid[])
          AND r.status IN ('error', 'unresolved')
        RETURNING r.id
      )
      SELECT COALESCE(jsonb_agg(id ORDER BY id), '[]'::jsonb)
      FROM skipped
    `, [ownerId, jobId, ids]);
  }
}

export class ImportPreviewService {
  /** @param {any} repository */
  constructor(repository) { this.repository = repository; }
  /** @param {string} ownerId @param {string} jobId @param {{status?: string, query?: string, page?: number, pageSize?: number}} [input] */
  async list(ownerId, jobId, input = {}) {
    const statuses = new Set(["new", "update", "duplicate", "error", "unresolved", "skipped"]);
    const status = input.status && input.status !== "all" ? input.status : undefined;
    if (status && !statuses.has(status)) throw new ImportPreviewError("IMPORT_PREVIEW_STATUS_INVALID", "Preview status is invalid.");
    const page = Number(input.page ?? 1);
    const pageSize = Number(input.pageSize ?? 50);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new ImportPreviewError("IMPORT_PREVIEW_PAGE_INVALID", "Preview page is invalid.");
    }
    const job = await this.repository.job(ownerId, jobId);
    return { job, ...await this.repository.rows(ownerId, jobId, {
      ...(status ? { status } : {}),
      ...(input.query?.trim() ? { query: input.query.trim() } : {}),
      page,
      pageSize,
    }) };
  }
  /** @param {string} ownerId @param {string} jobId @param {string[]} ids */
  async skip(ownerId, jobId, ids) { await this.repository.job(ownerId, jobId); return { jobId, skipped: await this.repository.skip(ownerId, jobId, ids) }; }
}
