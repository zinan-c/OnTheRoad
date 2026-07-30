import {
  assertIdempotencyKey,
  assertOwnerId,
  assertVersion,
  normalizeTripInput,
  normalizeTripPatch,
  tripRequestHash,
} from "@on-the-road/domain/trip";

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

  /** @param {unknown} ownerId @param {{limit?: number, search?: string, currency?: string, status?: string}} [filters] */
  listTrips(ownerId, filters = {}) {
    const limit = filters.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("limit must be an integer from 1 to 100");
    }
    return this.repository.list(assertOwnerId(ownerId), { ...filters, limit });
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
