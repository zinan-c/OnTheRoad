import { canonicalizeMapping, validateMapping } from "@on-the-road/importer";

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

export class ImportMappingService {
  /** @param {any} repository */
  constructor(repository) { this.repository = repository; }

  /** @param {string} ownerId @param {string} jobId @param {{mapping: Record<string, string>, sourceColumns: string[], requiredTargets?: string[], sheetNames?: string[], expectedVersion?: number}} input */
  save(ownerId, jobId, input) {
    const current = this.repository.find(ownerId, jobId);
    if (current && input.expectedVersion !== current.version) throw new ImportMappingError("IMPORT_MAPPING_VERSION_CONFLICT", "Mapping changed; reload before saving.", 409);
    const checked = validateMapping(input);
    if (!checked.valid) throw new ImportMappingError("IMPORT_MAPPING_INVALID", "Mapping requires correction.");
    return this.repository.save({ jobId, ownerId, mapping: canonicalizeMapping(checked.mapping), hash: checked.hash, version: (current?.version ?? 0) + 1, updatedAt: new Date().toISOString() });
  }

  /** @param {string} ownerId @param {string} jobId */
  get(ownerId, jobId) {
    const value = this.repository.find(ownerId, jobId);
    if (!value) throw new ImportMappingError("IMPORT_MAPPING_NOT_FOUND", "Mapping was not found.", 404);
    return value;
  }
}
