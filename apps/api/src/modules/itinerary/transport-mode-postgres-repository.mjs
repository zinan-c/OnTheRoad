import { TransportModeDomainError } from "@on-the-road/domain/transport-mode";
import {
  PostgresExecutor,
  postgresErrorIdentity,
} from "@on-the-road/database/postgres";

function notFound() {
  return new TransportModeDomainError(
    "TRANSPORT_MODE_NOT_FOUND",
    "Transport mode was not found.",
    404,
  );
}

function versionConflict() {
  return new TransportModeDomainError(
    "TRANSPORT_MODE_VERSION_CONFLICT",
    "Transport mode version does not match If-Match.",
    409,
  );
}

/** @param {unknown} error */
function mapDatabaseError(error) {
  const { constraint, message } = postgresErrorIdentity(error);
  if (
    message === "TRANSPORT_MODE_CODE_CONFLICT"
    || constraint === "custom_transport_mode_trip_id_code_key"
  ) {
    return new TransportModeDomainError(
      "TRANSPORT_MODE_CODE_CONFLICT",
      "Transport mode code already exists in this Trip.",
      409,
      "code",
    );
  }
  return error;
}

/** @param {string} alias */
function modeJson(alias) {
  return `jsonb_build_object(
    'id', ${alias}.id,
    'tripId', ${alias}.trip_id,
    'ownerId', ${alias}.owner_id,
    'code', ${alias}.code,
    'label', ${alias}.label,
    'icon', ${alias}.icon,
    'color', ${alias}.color,
    'lineStyle', ${alias}.line_style,
    'isSystem', false,
    'enabled', ${alias}.enabled,
    'referenced', EXISTS (
      SELECT 1 FROM itinerary_item i
      WHERE i.trip_id = ${alias}.trip_id
        AND i.transport_mode_code = ${alias}.code
        AND i.deleted_at IS NULL
    ),
    'version', ${alias}.version
  )`;
}

export class PostgresTransportModeRepository {
  /**
   * @param {{
   *  databaseUrl?: string,
   *  pool?: import("@on-the-road/database/postgres").PostgresExecutor["pool"],
   *  executor?: import("@on-the-road/database/postgres").PostgresExecutor
   * }} [options]
   */
  constructor({ databaseUrl, pool, executor } = {}) {
    this.database = executor ?? new PostgresExecutor({
      databaseUrl,
      pool,
      role: "api",
    });
  }

  /** @param {string} ownerId @param {string} tripId */
  async assertTripOwned(ownerId, tripId) {
    const owned = await this.#json(
      `SELECT to_jsonb(EXISTS (
        SELECT 1 FROM trip
        WHERE id = $1::uuid
          AND owner_id = $2
          AND deleted_at IS NULL
      ))::text`,
      [tripId, ownerId],
    );
    if (!owned) throw notFound();
  }

  /** @param {string} ownerId @param {string} tripId */
  async listCustom(ownerId, tripId) {
    await this.assertTripOwned(ownerId, tripId);
    return this.#json(
      `SELECT COALESCE(
        jsonb_agg(${modeJson("m")} ORDER BY m.code),
        '[]'::jsonb
      )::text
      FROM custom_transport_mode m
      WHERE m.trip_id = $1::uuid
        AND m.owner_id = $2`,
      [tripId, ownerId],
    );
  }

  /** @param {string} ownerId @param {string} tripId @param {{code: string, label: string, icon: string, color: string, lineStyle: string}} input */
  async createCustom(ownerId, tripId, input) {
    await this.assertTripOwned(ownerId, tripId);
    return this.#json(
      `WITH inserted AS (
        INSERT INTO custom_transport_mode (
          trip_id, owner_id, code, label, icon, color, line_style
        )
        VALUES (
          $1::uuid,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7
        )
        RETURNING *
      )
      SELECT ${modeJson("m")}::text FROM inserted m`,
      [tripId, ownerId, input.code, input.label, input.icon, input.color, input.lineStyle],
    );
  }

  /** @param {string} ownerId @param {string} tripId @param {string} modeId @param {Record<string, unknown>} patch @param {number} expectedVersion */
  async updateCustom(ownerId, tripId, modeId, patch, expectedVersion) {
    await this.assertTripOwned(ownerId, tripId);
    const current = /** @type {Record<string, any>} */ (await this.#get(ownerId, tripId, modeId));
    if (current.version !== expectedVersion) {
      throw versionConflict();
    }
    const merged = { ...current, ...patch };
    const updated = await this.#json(
      `WITH updated AS (
        UPDATE custom_transport_mode
        SET
          label = $1,
          icon = $2,
          color = $3,
          line_style = $4,
          version = version + 1,
          updated_at = clock_timestamp()
        WHERE id = $5::uuid
          AND trip_id = $6::uuid
          AND owner_id = $7
          AND version = $8::integer
        RETURNING *
      )
      SELECT ${modeJson("m")}::text FROM updated m`,
      [
        merged.label,
        merged.icon,
        merged.color,
        merged.lineStyle,
        modeId,
        tripId,
        ownerId,
        expectedVersion,
      ],
    );
    if (!updated) throw versionConflict();
    return updated;
  }

  /** @param {string} ownerId @param {string} tripId @param {string} modeId @param {number} expectedVersion */
  async deactivateCustom(ownerId, tripId, modeId, expectedVersion) {
    await this.assertTripOwned(ownerId, tripId);
    const current = /** @type {Record<string, any>} */ (await this.#get(ownerId, tripId, modeId));
    if (current.version !== expectedVersion) {
      throw versionConflict();
    }
    if (!current.enabled) return current;
    const updated = await this.#json(
      `WITH updated AS (
        UPDATE custom_transport_mode
        SET enabled = false, version = version + 1, updated_at = clock_timestamp()
        WHERE id = $1::uuid
          AND trip_id = $2::uuid
          AND owner_id = $3
          AND version = $4::integer
        RETURNING *
      )
      SELECT ${modeJson("m")}::text FROM updated m`,
      [modeId, tripId, ownerId, expectedVersion],
    );
    if (!updated) throw versionConflict();
    return updated;
  }

  /** @param {string} tripId @param {string} code */
  isReferenced(tripId, code) {
    return this.#json(
      `SELECT to_jsonb(EXISTS (
        SELECT 1 FROM itinerary_item
        WHERE trip_id = $1::uuid
          AND transport_mode_code = $2
          AND deleted_at IS NULL
      ))::text`,
      [tripId, code],
    );
  }

  /** @param {string} ownerId @param {string} tripId @param {string} modeId */
  async #get(ownerId, tripId, modeId) {
    const mode = await this.#json(
      `SELECT COALESCE(
        (
          SELECT ${modeJson("m")}
          FROM custom_transport_mode m
          WHERE m.id = $1::uuid
            AND m.trip_id = $2::uuid
            AND m.owner_id = $3
        ),
        'null'::jsonb
      )::text`,
      [modeId, tripId, ownerId],
    );
    if (!mode) throw notFound();
    return mode;
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
