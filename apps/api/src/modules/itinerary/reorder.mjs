// @ts-nocheck
import {
  assertCompleteDayOrder,
  assertBaseDayVersion,
  ItineraryOrderDayNotFoundError,
  ItineraryOrderError,
  ItineraryOrderVersionConflictError,
} from "../../../../../packages/domain/src/itinerary/order.mjs";
import {
  assertItineraryId,
  assertItineraryOwner,
} from "../../../../../packages/domain/src/itinerary/index.mjs";
import {
  PostgresExecutor,
  postgresErrorIdentity,
} from "@on-the-road/database/postgres";

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
  constructor({ databaseUrl, pool, executor } = {}) {
    this.database = executor ?? new PostgresExecutor({
      databaseUrl,
      pool,
      role: "api",
    });
  }

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
  constructor(repository) {
    if (!repository || typeof repository.reorder !== "function") {
      throw new TypeError("repository.reorder is required");
    }
    this.repository = repository;
  }

  reorder(ownerId, tripId, tripDayId, input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new ItineraryOrderError(
        "ITINERARY_ORDER_SET_MISMATCH",
        "reorder input must be an object.",
        422,
      );
    }
    const orderedIds = assertCompleteDayOrder(
      input.orderedIds,
      input.orderedIds,
    );
    return this.repository.reorder(
      assertItineraryOwner(ownerId),
      assertItineraryId(tripId, "tripId"),
      assertItineraryId(tripDayId, "tripDayId"),
      assertBaseDayVersion(input.baseVersion),
      orderedIds,
    );
  }
}
