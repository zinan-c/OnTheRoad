// @ts-nocheck
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { LocationDomainError } from "../../../../../packages/domain/src/location/index.mjs";

const execFileAsync = promisify(execFile);

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function jsonExpression(value) {
  return `convert_from(decode('${encode(value)}', 'base64'), 'utf8')::jsonb`;
}

function mapDatabaseError(error) {
  const message = `${error?.stderr ?? ""}\n${error?.message ?? ""}`;
  const mappings = [
    ["LOCATION_NOT_FOUND", 404],
    ["LOCATION_VERSION_CONFLICT", 409],
    ["INVALID_LOCATION_TRANSITION", 409],
    ["LOCATION_STATUS_INVALID", 400],
    ["MANUAL_LOCATION_MUST_BE_RESOLVED", 400],
    ["STALE_GEOCODING_RESULT", 409],
    ["RESOLVED_POINT_REQUIRED", 400],
  ];
  for (const [code, status] of mappings) {
    if (message.includes(code)) {
      return new LocationDomainError(
        code,
        code.replaceAll("_", " ").toLowerCase(),
        status,
      );
    }
  }
  return error;
}

export class PostgresLocationRepository {
  constructor({ databaseUrl, psqlBin = process.env.PSQL_BIN || "psql" }) {
    if (!databaseUrl) throw new TypeError("databaseUrl is required");
    this.databaseUrl = databaseUrl;
    this.psqlBin = psqlBin;
  }

  create(input) {
    return this.#json(`SELECT create_location(${jsonExpression(input)})::text`);
  }

  async getOwned(ownerId, locationId) {
    const result = await this.#json(
      `SELECT COALESCE(
        (
          SELECT location_as_json(l.id)
          FROM location l
          WHERE l.id = (${jsonExpression([locationId])}->>0)::uuid
            AND l.owner_id = ${jsonExpression([ownerId])}->>0
        ),
        'null'::jsonb
      )::text`,
    );
    if (!result) {
      throw new LocationDomainError(
        "LOCATION_NOT_FOUND",
        "Location was not found.",
        404,
      );
    }
    return result;
  }

  transition(ownerId, locationId, expectedVersion, target, payload = {}) {
    return this.#json(
      `SELECT transition_location(
        ${jsonExpression([ownerId])}->>0,
        (${jsonExpression([locationId])}->>0)::uuid,
        (${jsonExpression([expectedVersion])}->>0)::integer,
        ${jsonExpression([target])}->>0,
        ${jsonExpression(payload)}
      )::text`,
    );
  }

  adjustCoordinates(ownerId, locationId, expectedVersion, payload, audit) {
    return this.#json(
      `SELECT adjust_location_coordinates(
        ${jsonExpression([ownerId])}->>0,
        (${jsonExpression([locationId])}->>0)::uuid,
        (${jsonExpression([expectedVersion])}->>0)::integer,
        ${jsonExpression(payload)},
        ${jsonExpression(audit)}
      )::text`,
    );
  }

  listCoordinateAudits(ownerId, locationId) {
    return this.#json(
      `SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'locationId', audit.location_id,
            'ownerId', audit.owner_id,
            'action', audit.action,
            'fromVersion', audit.from_version,
            'toVersion', audit.to_version,
            'point', jsonb_build_object(
              'longitude', ST_X(audit.point),
              'latitude', ST_Y(audit.point),
              'crs', 'WGS84'
            ),
            'inputMode', audit.input_mode,
            'reverseStatus', audit.reverse_status,
            'occurredAt', to_char(
              audit.occurred_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            )
          )
          ORDER BY audit.audit_id
        ),
        '[]'::jsonb
      )::text
      FROM location_coordinate_audit audit
      WHERE audit.owner_id = ${jsonExpression([ownerId])}->>0
        AND audit.location_id = (${jsonExpression([locationId])}->>0)::uuid`,
    );
  }

  createJob(input) {
    return this.#json(
      `WITH inserted AS (
        INSERT INTO geocoding_job (
          trip_id, location_id, provider, query, context,
          input_location_version, status
        )
        VALUES (
          (${jsonExpression([input.tripId])}->>0)::uuid,
          (${jsonExpression([input.locationId])}->>0)::uuid,
          ${jsonExpression([input.provider])}->>0,
          ${jsonExpression([input.query])}->>0,
          ${jsonExpression(input.context ?? {})},
          (${jsonExpression([input.inputLocationVersion])}->>0)::integer,
          'queued'
        )
        RETURNING *
      )
      SELECT jsonb_build_object(
        'id', i.id,
        'tripId', i.trip_id,
        'locationId', i.location_id,
        'provider', i.provider,
        'query', i.query,
        'inputLocationVersion', i.input_location_version,
        'status', i.status,
        'candidates', i.candidates
      )::text
      FROM inserted i`,
    );
  }

  async getJobOwned(ownerId, jobId) {
    const result = await this.#json(
      `SELECT COALESCE(
        (
          SELECT jsonb_build_object(
            'id', j.id,
            'tripId', j.trip_id,
            'locationId', j.location_id,
            'provider', j.provider,
            'query', j.query,
            'inputLocationVersion', j.input_location_version,
            'status', j.status,
            'candidates', j.candidates
          )
          FROM geocoding_job j
          JOIN trip t ON t.id = j.trip_id
          WHERE j.id = (${jsonExpression([jobId])}->>0)::uuid
            AND t.owner_id = ${jsonExpression([ownerId])}->>0
        ),
        'null'::jsonb
      )::text`,
    );
    if (!result) {
      throw new LocationDomainError(
        "GEOCODING_JOB_NOT_FOUND",
        "Geocoding job was not found.",
        404,
      );
    }
    return result;
  }

  finishJob(jobId, status, candidates = null, errorCode = null) {
    return this.#json(
      `WITH updated AS (
        UPDATE geocoding_job
        SET
          status = ${jsonExpression([status])}->>0,
          candidates = ${candidates === null ? "NULL" : jsonExpression(candidates)},
          error_code = ${jsonExpression([errorCode])}->>0,
          completed_at = clock_timestamp(),
          updated_at = clock_timestamp()
        WHERE id = (${jsonExpression([jobId])}->>0)::uuid
        RETURNING *
      )
      SELECT jsonb_build_object(
        'id', u.id,
        'tripId', u.trip_id,
        'locationId', u.location_id,
        'provider', u.provider,
        'query', u.query,
        'inputLocationVersion', u.input_location_version,
        'status', u.status,
        'candidates', u.candidates,
        'errorCode', u.error_code
      )::text
      FROM updated u`,
    );
  }

  async #json(sql) {
    try {
      const { stdout } = await execFileAsync(
        this.psqlBin,
        [this.databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
        { maxBuffer: 2 * 1024 * 1024 },
      );
      return JSON.parse(stdout.trim() || "null");
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
