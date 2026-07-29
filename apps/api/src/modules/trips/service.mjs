// @ts-nocheck
import {
  assertIdempotencyKey,
  assertOwnerId,
  assertVersion,
  normalizeTripInput,
  normalizeTripPatch,
  tripRequestHash,
} from "../../../../../packages/domain/src/trip/index.mjs";

export class TripService {
  constructor(repository) {
    this.repository = repository;
  }

  createTrip(ownerId, input, { idempotencyKey }) {
    const owner = assertOwnerId(ownerId);
    const normalized = normalizeTripInput(input);
    const key = assertIdempotencyKey(idempotencyKey);
    return this.repository.create(owner, key, tripRequestHash(normalized), normalized);
  }

  getTrip(ownerId, tripId, options) {
    return this.repository.get(assertOwnerId(ownerId), tripId, options);
  }

  listTrips(ownerId, filters = {}) {
    const limit = filters.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("limit must be an integer from 1 to 100");
    }
    return this.repository.list(assertOwnerId(ownerId), { ...filters, limit });
  }

  updateTrip(ownerId, tripId, patch, { expectedVersion }) {
    return this.repository.update(
      assertOwnerId(ownerId),
      tripId,
      assertVersion(expectedVersion),
      normalizeTripPatch(patch),
    );
  }

  deleteTrip(ownerId, tripId, { expectedVersion }) {
    return this.repository.transition(
      assertOwnerId(ownerId),
      tripId,
      assertVersion(expectedVersion),
      "deleted",
    );
  }

  restoreTrip(ownerId, tripId, { expectedVersion }) {
    return this.repository.transition(
      assertOwnerId(ownerId),
      tripId,
      assertVersion(expectedVersion),
      "active",
    );
  }
}
