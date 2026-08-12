import { createHash, randomUUID } from "node:crypto";

import { assertWgs84Point } from "@on-the-road/domain/location";

export class ImportUnresolvedLocationError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] */
  constructor(code, message, status = 409) {
    super(message);
    this.name = "ImportUnresolvedLocationError";
    this.code = code;
    this.status = status;
  }
}

/**
 * The unresolved flow only mutates import staging and the import row. Formal
 * Location records are deliberately left to the import commit checkpoint.
 */
export class PostgresImportUnresolvedLocationService {
  /** @param {{database: import("@on-the-road/database/postgres").PostgresExecutor, candidateSigner: import("@on-the-road/domain/location").CandidateTokenSigner}} options */
  constructor({ database, candidateSigner }) {
    this.database = database;
    this.candidateSigner = candidateSigner;
  }

  /** @param {string} ownerId @param {string} jobId */
  async list(ownerId, jobId) {
    const rows = await this.database.query(
      `SELECT s.id, s.trip_id, s.source_row_key, s.staged_location,
              s.status, s.version, r.id AS import_row_id, r.status AS row_status,
              r.errors
       FROM import_location_staging s
       JOIN import_job j ON j.trip_id = s.trip_id AND j.id = $2::uuid AND j.owner_id = $1
       JOIN import_row r ON r.id = (s.staged_location->>'importRowId')::uuid
       WHERE s.owner_id = $1
         AND s.status = 'staged'
         AND r.status = 'unresolved'
       ORDER BY s.source_row_key, s.id`,
      [ownerId, jobId],
    );
    if (rows.rows.length === 0) await this.#assertJob(ownerId, jobId);
    return rows.rows.map((row) => this.#view(ownerId, jobId, row));
  }

  /** @param {string} ownerId @param {string} jobId @param {string} stagingId @param {Record<string, any>} input */
  async decide(ownerId, jobId, stagingId, input) {
    const result = await this.database.transaction(async (client) => {
      const row = (await client.query(
        `SELECT s.id, s.trip_id, s.owner_id, s.source_row_key, s.staged_location,
                s.status, s.version, r.id AS import_row_id, r.status AS row_status
         FROM import_location_staging s
         JOIN import_job j ON j.id = $2::uuid AND j.trip_id = s.trip_id AND j.owner_id = $1
         JOIN import_row r ON r.id = (s.staged_location->>'importRowId')::uuid
         WHERE s.id = $3::uuid AND s.owner_id = $1
         FOR UPDATE OF s, r`,
        [ownerId, jobId, stagingId],
      )).rows[0];
      if (!row) throw new ImportUnresolvedLocationError("STAGED_LOCATION_NOT_FOUND", "Staged location was not found.", 404);
      if (!['staged', 'ready'].includes(row.status) || !['unresolved', 'ready'].includes(row.row_status)) {
        throw new ImportUnresolvedLocationError("STAGED_LOCATION_NOT_EDITABLE", "The staged location is no longer editable.");
      }

      const decision = await this.#normalizeDecision(ownerId, row, input);
      const decisionVersion = Number((await client.query(
        `SELECT COALESCE((
           SELECT decision_version
           FROM staged_location_decision
           WHERE import_staging_id = $1::uuid
           ORDER BY decision_version DESC
           LIMIT 1
           FOR UPDATE
         ), 0) + 1 AS version
         FROM staged_location_decision
         WHERE import_staging_id = $1::uuid`,
        [stagingId],
      )).rows[0]?.version ?? 1);
      const decisionId = randomUUID();
      await client.query(
        `INSERT INTO staged_location_decision (
           id, trip_id, import_staging_id, actor_id, decision_type, source,
           decision_version, candidate_token_hash, payload
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9::jsonb)`,
        [decisionId, row.trip_id, stagingId, ownerId, decision.type, decision.source,
          decisionVersion, decision.tokenHash, JSON.stringify(decision.payload)],
      );
      await client.query(
        `UPDATE import_location_staging
         SET status = 'ready',
             staged_location = staged_location || $2::jsonb,
             version = version + 1,
             updated_at = now()
         WHERE id = $1::uuid`,
        [stagingId, JSON.stringify(decision.stagedLocation)],
      );
      await client.query(
        `UPDATE import_row
         SET status = 'ready', staged_location = COALESCE(staged_location, '{}'::jsonb) || $2::jsonb,
             updated_at = now()
         WHERE id = $1::uuid`,
        [row.import_row_id, JSON.stringify(decision.stagedLocation)],
      );
      await client.query(
        `UPDATE import_job j
         SET status = 'ready_to_import',
             stage = 'ready_to_import',
             updated_at = now()
         WHERE j.id = $1::uuid
           AND j.owner_id = $2
           AND j.status = 'confirmation_required'
           AND NOT EXISTS (
             SELECT 1
             FROM import_row r
             WHERE r.import_job_id = j.id
               AND r.status = 'unresolved'
           )`,
        [jobId, ownerId],
      );
      return {
        id: decisionId,
        importJobId: jobId,
        importRowId: row.import_row_id,
        stagingId,
        decisionType: decision.type,
        status: "ready",
        version: row.version + 1,
        stagedLocation: decision.stagedLocation,
      };
    });
    return result;
  }

  /** @param {string} ownerId @param {string} jobId @param {any} row */
  #view(ownerId, jobId, row) {
    const staged = isRecord(row.staged_location) ? row.staged_location : {};
    const rawCandidates = Array.isArray(staged.candidates) ? staged.candidates : [];
    const candidates = rawCandidates.flatMap(/** @param {any} candidate */ (candidate) => {
      if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.label !== "string") return [];
      if (!isRecord(candidate.point)) return [];
      try {
        const point = assertWgs84Point(candidate.point);
        const token = this.candidateSigner.sign({
          ownerId,
          tripId: row.trip_id,
          locationId: row.id,
          locationVersion: row.version,
          candidate: {
            attribution: typeof candidate.attribution === "string" ? candidate.attribution : "On The Road",
            countryCode: typeof candidate.countryCode === "string" ? candidate.countryCode : null,
            formattedAddress: typeof candidate.formattedAddress === "string" ? candidate.formattedAddress : undefined,
            city: typeof candidate.city === "string" ? candidate.city : null,
            district: typeof candidate.district === "string" ? candidate.district : null,
            confidence: typeof candidate.providerScore === "number" ? candidate.providerScore : null,
            provider: typeof candidate.provider === "string" ? candidate.provider : "unknown",
            label: candidate.label,
            point,
            providerPlaceId: candidate.id,
          },
        });
        return [{
          label: candidate.label,
          formattedAddress: typeof candidate.formattedAddress === "string" ? candidate.formattedAddress : candidate.label,
          countryCode: typeof candidate.countryCode === "string" ? candidate.countryCode : null,
          city: typeof candidate.city === "string" ? candidate.city : null,
          district: typeof candidate.district === "string" ? candidate.district : null,
          point,
          confidence: typeof candidate.providerScore === "number" ? candidate.providerScore : null,
          provider: typeof candidate.provider === "string" ? candidate.provider : "unknown",
          attribution: typeof candidate.attribution === "string" ? candidate.attribution : "On The Road",
          candidateToken: token,
        }];
      } catch {
        return [];
      }
    });
    return {
      id: row.id,
      tripId: row.trip_id,
      importJobId: jobId,
      importRowId: row.import_row_id,
      sourceRowKey: row.source_row_key,
      status: row.status,
      version: row.version,
      inputText: typeof staged.inputText === "string" ? staged.inputText : "",
      candidates,
      selectedPoint: isRecord(staged.point) ? staged.point : null,
      selectedType: typeof staged.decisionType === "string" ? staged.decisionType : null,
      errors: Array.isArray(row.errors) ? row.errors : [],
    };
  }

  /** @param {string} ownerId @param {any} row @param {Record<string, any>} input */
  async #normalizeDecision(ownerId, row, input) {
    const type = String(input.type ?? "");
    const inputText = typeof row.staged_location?.inputText === "string" ? row.staged_location.inputText : "";
    if (type === "candidate") {
      if (typeof input.candidateToken !== "string" || !input.candidateToken) {
        throw new ImportUnresolvedLocationError("CANDIDATE_TOKEN_REQUIRED", "A candidate token is required.", 422);
      }
      const candidate = /** @type {any} */ (this.candidateSigner.verify(input.candidateToken, {
        ownerId,
        tripId: row.trip_id,
        locationId: row.id,
        locationVersion: row.version,
      }));
      const point = assertWgs84Point(candidate.point);
    return {
        type: "candidate",
        source: "provider_candidate",
        tokenHash: createHash("sha256").update(input.candidateToken).digest("hex"),
        payload: { ...candidate, point },
        stagedLocation: {
          decisionType: "candidate",
          inputText,
          point,
          name: candidate.label,
          formattedAddress: candidate.formattedAddress ?? candidate.label,
          provider: candidate.provider ?? "unknown",
          providerPlaceId: candidate.providerPlaceId,
        },
      };
    }
    if (["map_point", "manual_coordinate"].includes(type)) {
      const pointInput = isRecord(input.point) ? input.point : input;
      const point = assertWgs84Point({
        latitude: Number(pointInput.latitude),
        longitude: Number(pointInput.longitude),
        crs: "WGS84",
      });
      return {
        type,
        source: type === "map_point" ? "map_click" : "manual_coordinate",
        tokenHash: null,
        payload: { point },
        stagedLocation: { decisionType: type, inputText, point, name: input.name?.trim() || inputText, provider: "manual" },
      };
    }
    if (type === "accept_text") {
      return {
        type,
        source: "text_only",
        tokenHash: null,
        payload: { inputText },
        stagedLocation: { decisionType: type, inputText, name: input.name?.trim() || inputText, provider: "text" },
      };
    }
    throw new ImportUnresolvedLocationError("STAGED_LOCATION_DECISION_INVALID", "The staged location decision is invalid.", 422);
  }

  /** @param {string} ownerId @param {string} jobId */
  async #assertJob(ownerId, jobId) {
    const exists = await this.database.json(
      `SELECT EXISTS(SELECT 1 FROM import_job WHERE id = $2::uuid AND owner_id = $1)::text`,
      [ownerId, jobId],
    );
    if (!exists) throw new ImportUnresolvedLocationError("IMPORT_JOB_NOT_FOUND", "Import job was not found.", 404);
  }
}

/** @param {unknown} value */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
