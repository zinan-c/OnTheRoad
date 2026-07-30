// @ts-nocheck
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  ItineraryDomainError,
  ItineraryNotFoundError,
  ItineraryVersionConflictError,
} from "../../../../../packages/domain/src/itinerary/index.mjs";

const execFileAsync = promisify(execFile);

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function jsonExpression(value) {
  return `convert_from(decode('${encode(value)}', 'base64'), 'utf8')::jsonb`;
}

function mapDatabaseError(error) {
  const message = `${error?.stderr ?? ""}\n${error?.message ?? ""}`;
  if (message.includes("ITINERARY_NOT_FOUND")) {
    return new ItineraryNotFoundError();
  }
  if (message.includes("ITINERARY_VERSION_CONFLICT")) {
    return new ItineraryVersionConflictError();
  }
  if (
    message.includes("ITINERARY_REFERENCE_MISMATCH")
    || message.includes("itinerary_")
    || message.includes("accommodation_")
    || message.includes("dining_")
  ) {
    return new ItineraryDomainError(
      "ITINERARY_REFERENCE_MISMATCH",
      "Referenced day, location, destination, or mode must belong to the same trip.",
      409,
    );
  }
  if (
    message.includes("violates check constraint")
    || message.includes("invalid input syntax")
  ) {
    return new ItineraryDomainError(
      "ITINERARY_VALIDATION_FAILED",
      "The itinerary item violates a database invariant.",
      422,
    );
  }
  return error;
}

export class PostgresItineraryRepository {
  constructor({ databaseUrl, psqlBin = process.env.PSQL_BIN || "psql" }) {
    if (!databaseUrl) throw new TypeError("databaseUrl is required");
    this.databaseUrl = databaseUrl;
    this.psqlBin = psqlBin;
  }

  create(ownerId, tripId, input) {
    return this.#json(
      `SELECT create_itinerary_item(
        ${jsonExpression([ownerId])}->>0,
        (${jsonExpression([tripId])}->>0)::uuid,
        ${jsonExpression(input)}
      )::text`,
    );
  }

  async get(ownerId, tripId, itemId, { includeDeleted = false } = {}) {
    const item = await this.#json(
      `SELECT COALESCE(
        (
          SELECT itinerary_item_as_json(item.id)
          FROM itinerary_item item
          WHERE item.id = (${jsonExpression([itemId])}->>0)::uuid
            AND item.trip_id = (${jsonExpression([tripId])}->>0)::uuid
            AND item.owner_id = ${jsonExpression([ownerId])}->>0
            ${includeDeleted ? "" : "AND item.deleted_at IS NULL"}
        ),
        'null'::jsonb
      )::text`,
    );
    if (!item) throw new ItineraryNotFoundError();
    return item;
  }

  listDay(ownerId, tripId, tripDayId) {
    return this.#json(
      `SELECT COALESCE(
        jsonb_agg(
          itinerary_item_as_json(item.id)
          ORDER BY item.sort_order, item.id
        ),
        '[]'::jsonb
      )::text
      FROM itinerary_item item
      WHERE item.trip_id = (${jsonExpression([tripId])}->>0)::uuid
        AND item.trip_day_id = (${jsonExpression([tripDayId])}->>0)::uuid
        AND item.owner_id = ${jsonExpression([ownerId])}->>0
        AND item.deleted_at IS NULL`,
    );
  }

  update(ownerId, tripId, itemId, expectedVersion, input) {
    return this.#json(
      `SELECT update_itinerary_item(
        ${jsonExpression([ownerId])}->>0,
        (${jsonExpression([tripId])}->>0)::uuid,
        (${jsonExpression([itemId])}->>0)::uuid,
        (${jsonExpression([expectedVersion])}->>0)::integer,
        ${jsonExpression(input)}
      )::text`,
    );
  }

  delete(ownerId, tripId, itemId, expectedVersion) {
    return this.#json(
      `SELECT delete_itinerary_item(
        ${jsonExpression([ownerId])}->>0,
        (${jsonExpression([tripId])}->>0)::uuid,
        (${jsonExpression([itemId])}->>0)::uuid,
        (${jsonExpression([expectedVersion])}->>0)::integer
      )::text`,
    );
  }

  copy(ownerId, tripId, itemId, targetTripDayId) {
    return this.#json(
      `SELECT copy_itinerary_item(
        ${jsonExpression([ownerId])}->>0,
        (${jsonExpression([tripId])}->>0)::uuid,
        (${jsonExpression([itemId])}->>0)::uuid,
        (${jsonExpression([targetTripDayId])}->>0)::uuid
      )::text`,
    );
  }

  async #json(sql) {
    try {
      const { stdout } = await execFileAsync(
        this.psqlBin,
        [this.databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
        { maxBuffer: 4 * 1024 * 1024 },
      );
      return JSON.parse(stdout.trim() || "null");
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
