import {
  PostgresExecutor,
  postgresErrorIdentity,
} from "@on-the-road/database/postgres";

import {
  IdempotencyKeyReusedError,
  TripNotFoundError,
  TripVersionConflictError,
} from "@on-the-road/domain/trip";

/** @param {unknown} error */
function mapDatabaseError(error) {
  const { message } = postgresErrorIdentity(error);
  if (message === "VERSION_CONFLICT") return new TripVersionConflictError();
  if (message === "TRIP_NOT_FOUND") return new TripNotFoundError();
  if (message === "IDEMPOTENCY_KEY_REUSED") return new IdempotencyKeyReusedError();
  return error;
}

export class PostgresTripRepository {
  /**
   * @param {{
   *  databaseUrl?: string,
   *  pool?: import("@on-the-road/database/postgres").PostgresExecutor["pool"],
   *  executor?: import("@on-the-road/database/postgres").PostgresExecutor
   * }} options
   */
  constructor({ databaseUrl, pool, executor }) {
    this.database = executor ?? new PostgresExecutor({
      databaseUrl,
      pool,
      role: "api",
    });
  }

  /** @param {string} ownerId @param {string} idempotencyKey @param {string} requestHash @param {Record<string, unknown>} input */
  async create(ownerId, idempotencyKey, requestHash, input) {
    return this.#json(
      `SELECT create_trip(
        $1,
        $2,
        $3,
        $4::jsonb
      )`,
      [ownerId, idempotencyKey, requestHash, JSON.stringify(input)],
    );
  }

  /** @param {string} ownerId @param {string} tripId @param {{includeDeleted?: boolean}} [options] */
  async get(ownerId, tripId, { includeDeleted = false } = {}) {
    const result = await this.#json(
      `SELECT COALESCE(
        (
          SELECT trip_as_json(t.id)
          FROM trip t
          WHERE t.id = $2::uuid
            AND t.owner_id = $1
            ${includeDeleted ? "" : "AND t.status <> 'deleted'"}
        ),
        'null'::jsonb
      )`,
      [ownerId, tripId],
    );
    if (result === null) throw new TripNotFoundError();
    return result;
  }

  /** @param {string} ownerId @param {{search?: string, currency?: string, status?: string, limit?: number}} filters */
  async list(ownerId, filters) {
    return this.#json(
      `WITH matching AS (
        SELECT t.*
        FROM trip t
        WHERE t.owner_id = $1
          AND t.status = COALESCE(NULLIF($4, ''), 'active')
          AND (
            NULLIF($3, '') IS NULL
            OR t.default_currency = $3
          )
          AND (
            NULLIF($2, '') IS NULL
            OR t.name ILIKE '%' || $2 || '%'
            OR EXISTS (
              SELECT 1 FROM destination d
              WHERE d.trip_id = t.id
                AND d.name ILIKE '%' || $2 || '%'
            )
        )
        ORDER BY t.updated_at DESC, t.id
        LIMIT $5::integer
      )
      SELECT jsonb_build_object(
        'items', COALESCE(jsonb_agg(trip_as_json(m.id) ORDER BY m.updated_at DESC, m.id), '[]'::jsonb),
        'nextCursor', NULL
      )
      FROM matching m`,
      [
        ownerId,
        filters.search ?? "",
        filters.currency ?? "",
        filters.status ?? "active",
        filters.limit ?? 20,
      ],
    );
  }

  /** @param {string} ownerId @param {string} tripId @param {number} expectedVersion @param {Record<string, unknown>} patch */
  async update(ownerId, tripId, expectedVersion, patch) {
    return this.#json(
      `SELECT update_trip(
        $1,
        $2::uuid,
        $3::integer,
        $4::jsonb
      )`,
      [ownerId, tripId, expectedVersion, JSON.stringify(patch)],
    );
  }

  /** @param {string} ownerId @param {string} tripId @param {number} expectedVersion @param {string} targetStatus */
  async transition(ownerId, tripId, expectedVersion, targetStatus) {
    return this.#json(
      `SELECT transition_trip(
        $1,
        $2::uuid,
        $3::integer,
        $4
      )`,
      [ownerId, tripId, expectedVersion, targetStatus],
    );
  }

  /** @param {string} ownerId @param {string} tripId */
  async listAudit(ownerId, tripId) {
    return this.#json(
      `SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'auditId', a.audit_id,
            'tripId', a.trip_id,
            'ownerId', a.owner_id,
            'action', a.action,
            'version', a.version,
            'changes', a.changes,
            'createdAt', to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          )
          ORDER BY a.audit_id
        ),
        '[]'::jsonb
      )
      FROM trip_audit a
      WHERE a.owner_id = $1
        AND a.trip_id = $2::uuid`,
      [ownerId, tripId],
    );
  }

  close() {
    return this.database.close();
  }

  /** @param {string} sql @param {readonly unknown[]} [values] */
  async #json(sql, values = []) {
    try {
      return await this.database.json(sql, values);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
