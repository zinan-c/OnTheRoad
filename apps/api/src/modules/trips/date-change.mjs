import {
  DateChangeRequiresConfirmationError,
  previewDateRangeChange,
} from "@on-the-road/domain/trip/date-range";

export class TripDateChangeService {
  /** @param {{loadDateContext: Function, applyDateRange: Function}} repository */
  constructor(repository) {
    this.repository = repository;
  }

  /** @param {string} ownerId @param {string} tripId @param {{startDate: string, endDate: string}} input */
  async preview(ownerId, tripId, { startDate, endDate }) {
    const context = /** @type {{days: any[], contentByDate: Record<string, any>, version: number}} */ (
      await this.repository.loadDateContext(ownerId, tripId)
    );
    return previewDateRangeChange({
      current: context.days,
      nextStartDate: startDate,
      nextEndDate: endDate,
      contentByDate: context.contentByDate,
    });
  }

  /** @param {string} ownerId @param {string} tripId @param {{startDate: string, endDate: string, expectedVersion: number, confirmDestructive?: boolean}} input */
  async apply(ownerId, tripId, {
    startDate,
    endDate,
    expectedVersion,
    confirmDestructive = false,
  }) {
    const context = /** @type {{days: any[], contentByDate: Record<string, any>, version: number}} */ (
      await this.repository.loadDateContext(ownerId, tripId)
    );
    const preview = previewDateRangeChange({
      current: context.days,
      nextStartDate: startDate,
      nextEndDate: endDate,
      contentByDate: context.contentByDate,
    });
    if (context.version !== expectedVersion) {
      throw Object.assign(
        new Error("Trip version does not match If-Match"),
        { code: "VERSION_CONFLICT", status: 409 },
      );
    }
    if (preview.blockers.length > 0 && !confirmDestructive) {
      throw new DateChangeRequiresConfirmationError(preview);
    }
    return this.repository.applyDateRange(ownerId, tripId, {
      startDate,
      endDate,
      expectedVersion,
      confirmDestructive,
    });
  }
}
