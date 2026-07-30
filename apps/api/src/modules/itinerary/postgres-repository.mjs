// @ts-nocheck
import {
  ItineraryDomainError,
  ItineraryNotFoundError,
  ItineraryVersionConflictError,
} from "../../../../../packages/domain/src/itinerary/index.mjs";
import {
  PostgresExecutor,
  postgresErrorIdentity,
} from "@on-the-road/database/postgres";

function mapDatabaseError(error) {
  const { code, constraint, message } = postgresErrorIdentity(error);
  if (message === "ITINERARY_NOT_FOUND") {
    return new ItineraryNotFoundError();
  }
  if (message === "ITINERARY_VERSION_CONFLICT") {
    return new ItineraryVersionConflictError();
  }
  if (
    message === "ITINERARY_REFERENCE_MISMATCH"
    || code === "23503"
    || constraint?.startsWith("itinerary_")
    || constraint?.startsWith("accommodation_")
    || constraint?.startsWith("dining_")
  ) {
    return new ItineraryDomainError(
      "ITINERARY_REFERENCE_MISMATCH",
      "Referenced day, location, destination, or mode must belong to the same trip.",
      409,
    );
  }
  if (
    code === "23514"
    || code === "22P02"
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
  constructor({ databaseUrl, pool, executor } = {}) {
    this.database = executor ?? new PostgresExecutor({
      databaseUrl,
      pool,
      role: "api",
    });
  }

  create(ownerId, tripId, input) {
    return this.#json(
      `SELECT create_itinerary_item(
        $1,
        $2::uuid,
        $3::jsonb
      )::text`,
      [ownerId, tripId, JSON.stringify(input)],
    );
  }

  async get(ownerId, tripId, itemId, { includeDeleted = false } = {}) {
    const item = await this.#json(
      `SELECT COALESCE(
        (
          SELECT itinerary_item_as_json(item.id)
          FROM itinerary_item item
          WHERE item.id = $1::uuid
            AND item.trip_id = $2::uuid
            AND item.owner_id = $3
            ${includeDeleted ? "" : "AND item.deleted_at IS NULL"}
        ),
        'null'::jsonb
      )::text`,
      [itemId, tripId, ownerId],
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
      WHERE item.trip_id = $1::uuid
        AND item.trip_day_id = $2::uuid
        AND item.owner_id = $3
        AND item.deleted_at IS NULL`,
      [tripId, tripDayId, ownerId],
    );
  }

  update(ownerId, tripId, itemId, expectedVersion, input) {
    return this.#json(
      `SELECT update_itinerary_item(
        $1,
        $2::uuid,
        $3::uuid,
        $4::integer,
        $5::jsonb
      )::text`,
      [ownerId, tripId, itemId, expectedVersion, JSON.stringify(input)],
    );
  }

  delete(ownerId, tripId, itemId, expectedVersion) {
    return this.#json(
      `SELECT delete_itinerary_item(
        $1,
        $2::uuid,
        $3::uuid,
        $4::integer
      )::text`,
      [ownerId, tripId, itemId, expectedVersion],
    );
  }

  copy(ownerId, tripId, itemId, targetTripDayId) {
    return this.#json(
      `SELECT copy_itinerary_item(
        $1,
        $2::uuid,
        $3::uuid,
        $4::uuid
      )::text`,
      [ownerId, tripId, itemId, targetTripDayId],
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
