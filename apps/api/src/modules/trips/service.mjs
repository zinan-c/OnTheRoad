import {
  assertIdempotencyKey,
  assertOwnerId,
  assertVersion,
  normalizeTripInput,
  normalizeTripPatch,
  tripRequestHash,
} from "@on-the-road/domain/trip";
import {
  decodeTripCursor,
  TRIP_LIST_ORDERS,
  TRIP_LIST_SORTS,
  tripListQueryKey,
} from "./cursor.mjs";

export class TripListQueryError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "TripListQueryError";
    this.code = "TRIP_LIST_QUERY_INVALID";
    this.status = 400;
  }
}

export class TripService {
  /** @param {any} repository */
  constructor(repository) {
    this.repository = repository;
  }

  /** @param {unknown} ownerId @param {unknown} input @param {{idempotencyKey: unknown}} options */
  createTrip(ownerId, input, { idempotencyKey }) {
    const owner = assertOwnerId(ownerId);
    const normalized = normalizeTripInput(input);
    const key = assertIdempotencyKey(idempotencyKey);
    return this.repository.create(owner, key, tripRequestHash(normalized), normalized);
  }

  /** @param {unknown} ownerId @param {string} tripId @param {{includeDeleted?: boolean}} [options] */
  getTrip(ownerId, tripId, options) {
    return this.repository.get(assertOwnerId(ownerId), tripId, options);
  }

  /** @param {unknown} ownerId @param {{limit?: number, cursor?: string, search?: string, currency?: string, status?: string, sort?: string, order?: string}} [filters] */
  listTrips(ownerId, filters = {}) {
    const limit = filters.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TripListQueryError("limit must be an integer from 1 to 100");
    }
    const search = typeof filters.search === "string" ? filters.search.trim() : "";
    if (search.length > 160) throw new TripListQueryError("search must be at most 160 characters");
    const currency = typeof filters.currency === "string" ? filters.currency.trim().toUpperCase() : "";
    if (currency && !/^[A-Z]{3}$/u.test(currency)) throw new TripListQueryError("currency must be a valid ISO currency code");
    const status = filters.status ?? "active";
    if (!['draft', 'active', 'archived', 'deleted'].includes(status)) {
      throw new TripListQueryError("status is not supported");
    }
    const sort = filters.sort ?? "lastActivityAt";
    if (!Object.hasOwn(TRIP_LIST_SORTS, sort)) throw new TripListQueryError("sort is not supported");
    const order = filters.order ?? "desc";
    if (!TRIP_LIST_ORDERS.includes(order)) throw new TripListQueryError("order must be asc or desc");
    let cursor = null;
    if (filters.cursor) {
      cursor = decodeTripCursor(filters.cursor);
      const queryKey = tripListQueryKey({ search, currency, status, sort, order });
      if (cursor.queryKey !== queryKey || cursor.sort !== sort || cursor.order !== order) {
        throw new TripListQueryError("cursor does not match the requested list");
      }
    }
    return this.repository.list(assertOwnerId(ownerId), {
      search,
      currency,
      status,
      sort,
      order,
      cursor,
      queryKey: tripListQueryKey({ search, currency, status, sort, order }),
      limit,
    });
  }

  /** @param {unknown} ownerId @param {string} tripId @param {unknown} patch @param {{expectedVersion: unknown}} options */
  updateTrip(ownerId, tripId, patch, { expectedVersion }) {
    return this.repository.update(
      assertOwnerId(ownerId),
      tripId,
      assertVersion(expectedVersion),
      normalizeTripPatch(patch),
    );
  }

  /** @param {unknown} ownerId @param {string} tripId @param {{expectedVersion: unknown}} options */
  deleteTrip(ownerId, tripId, { expectedVersion }) {
    return this.repository.transition(
      assertOwnerId(ownerId),
      tripId,
      assertVersion(expectedVersion),
      "deleted",
    );
  }

  /** @param {unknown} ownerId @param {string} tripId @param {{expectedVersion: unknown}} options */
  restoreTrip(ownerId, tripId, { expectedVersion }) {
    return this.repository.transition(
      assertOwnerId(ownerId),
      tripId,
      assertVersion(expectedVersion),
      "active",
    );
  }
}
