import {
  assertCompleteDayOrder,
  assertBaseDayVersion,
  ItineraryOrderDayNotFoundError,
  ItineraryOrderError,
  ItineraryOrderVersionConflictError,
} from "@on-the-road/domain/itinerary/order";
import {
  assertItineraryId,
  assertItineraryOwner,
} from "@on-the-road/domain/itinerary";
import {
  PostgresExecutor,
  postgresErrorIdentity,
} from "@on-the-road/database/postgres";

/** @param {unknown} error */
function mapDatabaseError(error) {
  const { message } = postgresErrorIdentity(error);
  if (message === "ITINERARY_ORDER_VERSION_CONFLICT") {
    return new ItineraryOrderVersionConflictError();
  }
  if (message === "ITINERARY_ORDER_DAY_NOT_FOUND") {
    return new ItineraryOrderDayNotFoundError();
  }
  if (message === "ITINERARY_ORDER_SET_MISMATCH") {
    return new ItineraryOrderError(
      "ITINERARY_ORDER_SET_MISMATCH",
      "orderedIds must be the complete unique ID set for one Day.",
      422,
    );
  }
  return error;
}

export class PostgresItineraryOrderRepository {
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

  /** @param {string} ownerId @param {string} tripId @param {string} tripDayId @param {number} baseVersion @param {readonly string[]} orderedIds */
  async reorder(ownerId, tripId, tripDayId, baseVersion, orderedIds) {
    try {
      return await this.database.json(
        `SELECT reorder_itinerary_items(
          $1,
          $2::uuid,
          $3::uuid,
          $4::integer,
          $5::jsonb
        )::text`,
        [ownerId, tripId, tripDayId, baseVersion, JSON.stringify(orderedIds)],
      );
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  close() {
    return this.database.close();
  }
}

export class ItineraryOrderService {
  /** @param {{reorder: Function}} repository */
  constructor(repository) {
    if (!repository || typeof repository.reorder !== "function") {
      throw new TypeError("repository.reorder is required");
    }
    this.repository = repository;
  }

  /** @param {unknown} ownerId @param {unknown} tripId @param {unknown} tripDayId @param {unknown} input */
  reorder(ownerId, tripId, tripDayId, input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new ItineraryOrderError(
        "ITINERARY_ORDER_SET_MISMATCH",
        "reorder input must be an object.",
        422,
      );
    }
    const candidate = /** @type {Record<string, unknown>} */ (input);
    const orderedIds = assertCompleteDayOrder(
      candidate.orderedIds,
      candidate.orderedIds,
    );
    return this.repository.reorder(
      assertItineraryOwner(ownerId),
      assertItineraryId(tripId, "tripId"),
      assertItineraryId(tripDayId, "tripDayId"),
      assertBaseDayVersion(candidate.baseVersion),
      orderedIds,
    );
  }
}
