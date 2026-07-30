// @ts-nocheck
import { LocationDomainError } from "../../../../../packages/domain/src/location/index.mjs";
import {
  PostgresExecutor,
  postgresErrorIdentity,
} from "@on-the-road/database/postgres";

function mapDatabaseError(error) {
  const { message } = postgresErrorIdentity(error);
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
    if (message === code) {
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
  constructor({ databaseUrl, pool, executor } = {}) {
    this.database = executor ?? new PostgresExecutor({
      databaseUrl,
      pool,
      role: "api",
    });
  }

  create(input) {
    return this.#json("SELECT create_location($1::jsonb)::text", [
      JSON.stringify(input),
    ]);
  }

  async getOwned(ownerId, locationId) {
    const result = await this.#json(
      `SELECT COALESCE(
        (
          SELECT location_as_json(l.id)
          FROM location l
          WHERE l.id = $1::uuid
            AND l.owner_id = $2
        ),
        'null'::jsonb
      )::text`,
      [locationId, ownerId],
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
        $1,
        $2::uuid,
        $3::integer,
        $4,
        $5::jsonb
      )::text`,
      [ownerId, locationId, expectedVersion, target, JSON.stringify(payload)],
    );
  }

  adjustCoordinates(ownerId, locationId, expectedVersion, payload, audit) {
    return this.#json(
      `SELECT adjust_location_coordinates(
        $1,
        $2::uuid,
        $3::integer,
        $4::jsonb,
        $5::jsonb
      )::text`,
      [
        ownerId,
        locationId,
        expectedVersion,
        JSON.stringify(payload),
        JSON.stringify(audit),
      ],
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
      WHERE audit.owner_id = $1
        AND audit.location_id = $2::uuid`,
      [ownerId, locationId],
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
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          $5::jsonb,
          $6::integer,
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
      [
        input.tripId,
        input.locationId,
        input.provider,
        input.query,
        JSON.stringify(input.context ?? {}),
        input.inputLocationVersion,
      ],
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
          WHERE j.id = $1::uuid
            AND t.owner_id = $2
        ),
        'null'::jsonb
      )::text`,
      [jobId, ownerId],
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
          status = $1,
          candidates = $2::jsonb,
          error_code = $3,
          completed_at = clock_timestamp(),
          updated_at = clock_timestamp()
        WHERE id = $4::uuid
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
      [
        status,
        candidates === null ? null : JSON.stringify(candidates),
        errorCode,
        jobId,
      ],
    );
  }

  close() {
    return this.database.close();
  }

  async #json(sql, values = []) {
    try {
      return await this.database.json(sql, values);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
