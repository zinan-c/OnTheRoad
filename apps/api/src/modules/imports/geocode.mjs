import { randomUUID } from "node:crypto";

export class ImportGeocodeError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] */
  constructor(code, message, status = 409) {
    super(message);
    this.name = "ImportGeocodeError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Creates one durable batch per user request. The batch units are the
 * import-location staging records, so a retry never creates a formal Location.
 */
export class PostgresImportGeocodeService {
  /** @param {{database: import("@on-the-road/database/postgres").PostgresExecutor, queue?: any, provider?: string}} options */
  constructor({ database, queue, provider = "fixture" }) {
    this.database = database;
    this.queue = queue;
    this.provider = provider;
  }

  /** @param {string} ownerId @param {string} jobId */
  async start(ownerId, jobId) {
    const batch = await this.database.transaction(async (client) => {
      const job = (await client.query(
        `SELECT j.id, j.trip_id, j.owner_id, j.status, t.map_profile
         FROM import_job j
         JOIN trip t ON t.id = j.trip_id AND t.owner_id = j.owner_id
         WHERE j.id = $2::uuid AND j.owner_id = $1
         FOR UPDATE`,
        [ownerId, jobId],
      )).rows[0];
      if (!job) throw new ImportGeocodeError("IMPORT_JOB_NOT_FOUND", "Import job was not found.", 404);
      if (!["confirmation_required", "geocoding"].includes(job.status)) {
        throw new ImportGeocodeError("IMPORT_JOB_NOT_GEOCODABLE", "The import job is not ready for batch geocoding.");
      }

      const active = (await client.query(
        `SELECT id FROM geocoding_batch
         WHERE import_job_id = $1::uuid
           AND status IN ('queued', 'running', 'waiting_rate_limit', 'cancelling')
         ORDER BY generation DESC, id DESC
         LIMIT 1`,
        [jobId],
      )).rows[0];
      if (active) return this.#batch(client, active.id);

      const units = (await client.query(
        `SELECT s.id AS staging_id, r.id AS row_id, r.source_row_key,
                r.normalized_data
         FROM import_row r
         JOIN import_location_staging s
           ON s.trip_id = $1::uuid
          AND s.source_row_key = $2 || ':' || r.source_row_key
         WHERE r.import_job_id = $2::uuid
           AND r.status = 'unresolved'
           AND s.status = 'staged'
         ORDER BY r.sheet_name, r.row_number, r.id
         FOR UPDATE OF r, s`,
        [job.trip_id, jobId],
      )).rows;
      const generation = Number((await client.query(
        `SELECT COALESCE(max(generation), 0) + 1 AS generation
         FROM geocoding_batch WHERE import_job_id = $1::uuid`,
        [jobId],
      )).rows[0]?.generation ?? 1);
      const batchId = randomUUID();
      const geocodableUnits = units.filter((unit) => locationQuery(unit.normalized_data ?? {}) !== null);
      await client.query(
        `INSERT INTO geocoding_batch (
           id, trip_id, owner_id, import_job_id, provider, map_profile,
           generation, status, total_units, queued_units
         ) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7, $8, $9, $9)
         RETURNING id`,
        [batchId, job.trip_id, ownerId, jobId, this.provider, job.map_profile,
          generation, "queued", geocodableUnits.length],
      );
      for (const unit of geocodableUnits) {
        const normalized = unit.normalized_data && typeof unit.normalized_data === "object"
          ? unit.normalized_data
          : {};
        const query = locationQuery(normalized);
        if (!query) continue;
        await client.query(
          `INSERT INTO geocoding_job (
             id, trip_id, import_staging_id, batch_id, provider, query,
             context, status, max_attempts
           ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::jsonb, 'queued', 4)`,
          [randomUUID(), job.trip_id, unit.staging_id, batchId, this.provider, query,
            JSON.stringify({
              ...(typeof normalized.countryCode === "string" ? { countryCodes: [normalized.countryCode] } : {}),
              sourceRowKey: unit.source_row_key,
              importRowId: unit.row_id,
            })],
        );
      }
      await client.query(
        `UPDATE import_job
         SET status = CASE
               WHEN $2::integer = 0 AND NOT EXISTS (
                 SELECT 1 FROM import_row r
                 WHERE r.import_job_id = import_job.id AND r.status = 'unresolved'
               ) THEN 'ready_to_import'
               WHEN $2::integer = 0 THEN 'confirmation_required'
               ELSE 'geocoding'
             END,
             stage = CASE
               WHEN $2::integer = 0 AND NOT EXISTS (
                 SELECT 1 FROM import_row r
                 WHERE r.import_job_id = import_job.id AND r.status = 'unresolved'
               ) THEN 'ready_to_import'
               WHEN $2::integer = 0 THEN 'confirmation_required'
               ELSE 'geocoding'
             END,
             updated_at = now()
         WHERE id = $1::uuid`,
         [jobId, geocodableUnits.length],
      );
      if (geocodableUnits.length === 0) {
        await client.query(
          `UPDATE geocoding_batch SET completed_at = now(), updated_at = now() WHERE id = $1::uuid`,
          [batchId],
        );
      }
      return this.#batch(client, batchId);
    });
    if (batch.status === "queued") {
      await this.queue?.lpush("otr:geocode", JSON.stringify({ batchId: batch.id }));
    }
    return batch;
  }

  /** @param {string} ownerId @param {string} jobId */
  async get(ownerId, jobId) {
    const batch = await this.database.json(
      `SELECT COALESCE((
        SELECT jsonb_build_object(
          'id', b.id, 'tripId', b.trip_id, 'importJobId', b.import_job_id,
          'provider', b.provider, 'mapProfile', b.map_profile,
          'generation', b.generation, 'status', b.status,
          'totalUnits', b.total_units, 'queuedUnits', b.queued_units,
          'resolvingUnits', b.resolving_units, 'resolvedUnits', b.resolved_units,
          'ambiguousUnits', b.ambiguous_units, 'failedUnits', b.failed_units,
          'cancelledUnits', b.cancelled_units,
          'cancelRequestedAt', b.cancel_requested_at,
          'createdAt', b.created_at, 'updatedAt', b.updated_at,
          'completedAt', b.completed_at
        )
        FROM geocoding_batch b
        WHERE b.import_job_id = $2::uuid AND b.owner_id = $1
        ORDER BY b.generation DESC, b.id DESC LIMIT 1
      ), 'null'::jsonb)::text`,
      [ownerId, jobId],
    );
    if (!batch) throw new ImportGeocodeError("GEOCODING_BATCH_NOT_FOUND", "Geocoding batch was not found.", 404);
    return batch;
  }

  /** @param {string} ownerId @param {string} jobId */
  async cancel(ownerId, jobId) {
    const batch = await this.database.json(
      `UPDATE geocoding_batch b
       SET status = CASE WHEN b.status = 'queued' THEN 'cancelled' ELSE 'cancelling' END,
           cancel_requested_at = COALESCE(b.cancel_requested_at, now()),
           updated_at = now()
       FROM import_job j
       WHERE b.import_job_id = j.id AND b.id = (
         SELECT id FROM geocoding_batch
         WHERE import_job_id = $2::uuid
         ORDER BY generation DESC, id DESC LIMIT 1
       )
         AND j.id = $2::uuid AND j.owner_id = $1
         AND b.status IN ('queued', 'running', 'waiting_rate_limit')
       RETURNING jsonb_build_object(
         'id', b.id, 'status', b.status, 'cancelRequestedAt', b.cancel_requested_at
       )::text`,
      [ownerId, jobId],
    );
    if (!batch) throw new ImportGeocodeError("GEOCODING_BATCH_NOT_CANCELLABLE", "The geocoding batch cannot be cancelled.");
    if (batch.status === "cancelled") await this.queue?.lpush("otr:geocode", JSON.stringify({ batchId: batch.id }));
    return batch;
  }

  /**
   * @param {import("@on-the-road/database/postgres").PoolClient} client
   * @param {string} batchId
   */
  async #batch(client, batchId) {
    const result = await client.query(
      `SELECT jsonb_build_object(
         'id', b.id, 'tripId', b.trip_id, 'importJobId', b.import_job_id,
         'provider', b.provider, 'mapProfile', b.map_profile,
         'generation', b.generation, 'status', b.status,
         'totalUnits', b.total_units, 'queuedUnits', b.queued_units,
         'resolvingUnits', b.resolving_units, 'resolvedUnits', b.resolved_units,
         'ambiguousUnits', b.ambiguous_units, 'failedUnits', b.failed_units,
         'cancelledUnits', b.cancelled_units,
         'cancelRequestedAt', b.cancel_requested_at,
         'createdAt', b.created_at, 'updatedAt', b.updated_at,
         'completedAt', b.completed_at
       )::text AS value
       FROM geocoding_batch b WHERE b.id = $1::uuid`,
      [batchId],
    );
    const value = result.rows[0]?.value;
    return typeof value === "string" ? JSON.parse(value) : value;
  }
}

/**
 * @param {Record<string, any>} normalized
 */
function locationQuery(normalized) {
  for (const key of ["address", "place", "startLocation", "endLocation"]) {
    if (typeof normalized[key] === "string" && normalized[key].trim()) return normalized[key].trim();
  }
  return null;
}
