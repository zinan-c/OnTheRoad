// @ts-nocheck
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { TransportModeDomainError } from "../../../../../packages/domain/src/transport-mode/index.mjs";

const execFileAsync = promisify(execFile);

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function jsonExpression(value) {
  return `convert_from(decode('${encode(value)}', 'base64'), 'utf8')::jsonb`;
}

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

function mapDatabaseError(error) {
  const message = `${error?.stderr ?? ""}\n${error?.message ?? ""}`;
  if (
    message.includes("TRANSPORT_MODE_CODE_CONFLICT")
    || message.includes("custom_transport_mode_trip_id_code_key")
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
  constructor({ databaseUrl, psqlBin = process.env.PSQL_BIN || "psql" }) {
    if (!databaseUrl) throw new TypeError("databaseUrl is required");
    this.databaseUrl = databaseUrl;
    this.psqlBin = psqlBin;
  }

  async assertTripOwned(ownerId, tripId) {
    const owned = await this.#json(
      `SELECT to_jsonb(EXISTS (
        SELECT 1 FROM trip
        WHERE id = (${jsonExpression([tripId])}->>0)::uuid
          AND owner_id = ${jsonExpression([ownerId])}->>0
          AND deleted_at IS NULL
      ))::text`,
    );
    if (!owned) throw notFound();
  }

  async listCustom(ownerId, tripId) {
    await this.assertTripOwned(ownerId, tripId);
    return this.#json(
      `SELECT COALESCE(
        jsonb_agg(${modeJson("m")} ORDER BY m.code),
        '[]'::jsonb
      )::text
      FROM custom_transport_mode m
      WHERE m.trip_id = (${jsonExpression([tripId])}->>0)::uuid
        AND m.owner_id = ${jsonExpression([ownerId])}->>0`,
    );
  }

  async createCustom(ownerId, tripId, input) {
    await this.assertTripOwned(ownerId, tripId);
    return this.#json(
      `WITH inserted AS (
        INSERT INTO custom_transport_mode (
          trip_id, owner_id, code, label, icon, color, line_style
        )
        VALUES (
          (${jsonExpression([tripId])}->>0)::uuid,
          ${jsonExpression([ownerId])}->>0,
          ${jsonExpression([input.code])}->>0,
          ${jsonExpression([input.label])}->>0,
          ${jsonExpression([input.icon])}->>0,
          ${jsonExpression([input.color])}->>0,
          ${jsonExpression([input.lineStyle])}->>0
        )
        RETURNING *
      )
      SELECT ${modeJson("m")}::text FROM inserted m`,
    );
  }

  async updateCustom(ownerId, tripId, modeId, patch, expectedVersion) {
    await this.assertTripOwned(ownerId, tripId);
    const current = await this.#get(ownerId, tripId, modeId);
    if (current.version !== expectedVersion) {
      throw versionConflict();
    }
    const merged = { ...current, ...patch };
    const updated = await this.#json(
      `WITH updated AS (
        UPDATE custom_transport_mode
        SET
          label = ${jsonExpression([merged.label])}->>0,
          icon = ${jsonExpression([merged.icon])}->>0,
          color = ${jsonExpression([merged.color])}->>0,
          line_style = ${jsonExpression([merged.lineStyle])}->>0,
          version = version + 1,
          updated_at = clock_timestamp()
        WHERE id = (${jsonExpression([modeId])}->>0)::uuid
          AND trip_id = (${jsonExpression([tripId])}->>0)::uuid
          AND owner_id = ${jsonExpression([ownerId])}->>0
          AND version = (${jsonExpression([expectedVersion])}->>0)::integer
        RETURNING *
      )
      SELECT ${modeJson("m")}::text FROM updated m`,
    );
    if (!updated) throw versionConflict();
    return updated;
  }

  async deactivateCustom(ownerId, tripId, modeId, expectedVersion) {
    await this.assertTripOwned(ownerId, tripId);
    const current = await this.#get(ownerId, tripId, modeId);
    if (current.version !== expectedVersion) {
      throw versionConflict();
    }
    if (!current.enabled) return current;
    const updated = await this.#json(
      `WITH updated AS (
        UPDATE custom_transport_mode
        SET enabled = false, version = version + 1, updated_at = clock_timestamp()
        WHERE id = (${jsonExpression([modeId])}->>0)::uuid
          AND trip_id = (${jsonExpression([tripId])}->>0)::uuid
          AND owner_id = ${jsonExpression([ownerId])}->>0
          AND version = (${jsonExpression([expectedVersion])}->>0)::integer
        RETURNING *
      )
      SELECT ${modeJson("m")}::text FROM updated m`,
    );
    if (!updated) throw versionConflict();
    return updated;
  }

  isReferenced(tripId, code) {
    return this.#json(
      `SELECT to_jsonb(EXISTS (
        SELECT 1 FROM itinerary_item
        WHERE trip_id = (${jsonExpression([tripId])}->>0)::uuid
          AND transport_mode_code = ${jsonExpression([code])}->>0
          AND deleted_at IS NULL
      ))::text`,
    );
  }

  async #get(ownerId, tripId, modeId) {
    const mode = await this.#json(
      `SELECT COALESCE(
        (
          SELECT ${modeJson("m")}
          FROM custom_transport_mode m
          WHERE m.id = (${jsonExpression([modeId])}->>0)::uuid
            AND m.trip_id = (${jsonExpression([tripId])}->>0)::uuid
            AND m.owner_id = ${jsonExpression([ownerId])}->>0
        ),
        'null'::jsonb
      )::text`,
    );
    if (!mode) throw notFound();
    return mode;
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
