import { canonicalizeMapping, suggestMappings, validateMapping } from "@on-the-road/importer";

export class ImportMappingError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] */
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ImportMappingError";
    this.code = code;
    this.status = status;
  }
}

export class InMemoryImportMappingRepository {
  /** @type {Map<string, Record<string, any>>} */
  mappings = new Map();

  /** @param {string} ownerId @param {string} jobId */
  find(ownerId, jobId) {
    const value = this.mappings.get(jobId);
    return value?.ownerId === ownerId ? structuredClone(value) : null;
  }

  /** @param {Record<string, any>} value */
  save(value) { this.mappings.set(value.jobId, structuredClone(value)); return structuredClone(value); }
}

export class PostgresImportMappingRepository {
  /** @param {{executor: any, queue?: any}} options */
  constructor({ executor, queue }) { this.database = executor; this.queue = queue; }
  /** @param {string} ownerId @param {string} jobId */
  find(ownerId, jobId) {
    return this.database.json(`
      SELECT COALESCE((
        SELECT jsonb_build_object(
          'jobId', j.id, 'ownerId', j.owner_id, 'mapping', j.mapping,
          'hash', j.mapping_hash, 'version', j.mapping_version, 'updatedAt', j.updated_at,
          'sourceColumns', COALESCE((
            SELECT jsonb_agg(column_name ORDER BY column_name)
            FROM (
              SELECT DISTINCT jsonb_object_keys(r.raw_data) AS column_name
              FROM import_row r WHERE r.import_job_id = j.id
            ) source_columns
          ), '[]'::jsonb),
          'sheetNames', COALESCE((
            SELECT jsonb_agg(sheet_name ORDER BY sheet_name)
            FROM (SELECT DISTINCT r.sheet_name FROM import_row r WHERE r.import_job_id = j.id) sheets
          ), '[]'::jsonb),
          'sampleRows', COALESCE((
            SELECT jsonb_agg(sample.raw_data ORDER BY sample.sheet_name, sample.row_number)
            FROM (
              SELECT r.raw_data, r.sheet_name, r.row_number
              FROM import_row r WHERE r.import_job_id = j.id
              ORDER BY r.sheet_name, r.row_number LIMIT 5
            ) sample
          ), '[]'::jsonb)
        )
        FROM import_job j WHERE j.id = $2::uuid AND j.owner_id = $1
      ), 'null'::jsonb)::text
    `, [ownerId, jobId]);
  }
  /** @param {string} ownerId @param {string} tripId */
  latest(ownerId, tripId) { return this.database.json(`SELECT COALESCE((SELECT jsonb_build_object('id', id, 'status', status, 'mappingVersion', mapping_version, 'updatedAt', updated_at) FROM import_job WHERE owner_id = $1 AND trip_id = $2::uuid ORDER BY created_at DESC, id DESC LIMIT 1), 'null'::jsonb)::text`, [ownerId, tripId]); }
  /** @param {Record<string, any>} value */
  async save(value) {
    const saved = await this.database.json(`UPDATE import_job SET mapping = $3::jsonb, mapping_hash = $4, mapping_version = mapping_version + 1, status = 'validating', stage = 'validating', updated_at = now() WHERE id = $2::uuid AND owner_id = $1 RETURNING jsonb_build_object('jobId', id, 'ownerId', owner_id, 'mapping', mapping, 'hash', mapping_hash, 'version', mapping_version, 'updatedAt', updated_at)::text`, [value.ownerId, value.jobId, JSON.stringify(value.mapping), value.hash]);
    if (!saved) throw new ImportMappingError("IMPORT_MAPPING_NOT_FOUND", "Mapping was not found.", 404);
    await this.queue?.lpush("otr:import-stage", JSON.stringify({ jobId: value.jobId }));
    return saved;
  }
}

export class ImportMappingService {
  /** @param {any} repository */
  constructor(repository) { this.repository = repository; }

  /** @param {string} ownerId @param {string} jobId @param {{mapping: Record<string, string>, sourceColumns: string[], requiredTargets?: string[], sheetNames?: string[], expectedVersion?: number}} input */
  async save(ownerId, jobId, input) {
    const current = await this.repository.find(ownerId, jobId);
    if (current && input.expectedVersion !== undefined && input.expectedVersion !== current.version) throw new ImportMappingError("IMPORT_MAPPING_VERSION_CONFLICT", "Mapping changed; reload before saving.", 409);
    const checked = validateMapping(input);
    if (!checked.valid) throw new ImportMappingError("IMPORT_MAPPING_INVALID", "Mapping requires correction.");
    return this.repository.save({ jobId, ownerId, mapping: canonicalizeMapping(checked.mapping), hash: checked.hash, version: (current?.version ?? 0) + 1, updatedAt: new Date().toISOString() });
  }

  /** @param {string} ownerId @param {string} jobId */
  async get(ownerId, jobId) {
    const value = await this.repository.find(ownerId, jobId);
    if (!value) throw new ImportMappingError("IMPORT_MAPPING_NOT_FOUND", "Mapping was not found.", 404);
    const sourceColumns = value.sourceColumns ?? [];
    return { ...value, sourceColumns, sheetNames: value.sheetNames ?? [], sampleRows: value.sampleRows ?? [], suggestions: suggestMappings({ sourceColumns, sampleRows: value.sampleRows ?? [] }) };
  }

  /** @param {string} ownerId @param {string} tripId */
  async latest(ownerId, tripId) {
    if (typeof this.repository.latest !== "function") return null;
    return this.repository.latest(ownerId, tripId);
  }
}
