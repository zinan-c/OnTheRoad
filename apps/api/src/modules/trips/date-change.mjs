// @ts-nocheck
import {
  DateChangeRequiresConfirmationError,
  previewDateRangeChange,
} from "../../../../../packages/domain/src/trip/date-range.mjs";

export class TripDateChangeService {
  constructor(repository) {
    this.repository = repository;
  }

  async preview(ownerId, tripId, { startDate, endDate }) {
    const context = await this.repository.loadDateContext(ownerId, tripId);
    return previewDateRangeChange({
      current: context.days,
      nextStartDate: startDate,
      nextEndDate: endDate,
      contentByDate: context.contentByDate,
    });
  }

  async apply(ownerId, tripId, {
    startDate,
    endDate,
    expectedVersion,
    confirmDestructive = false,
  }) {
    const context = await this.repository.loadDateContext(ownerId, tripId);
    const preview = previewDateRangeChange({
      current: context.days,
      nextStartDate: startDate,
      nextEndDate: endDate,
      contentByDate: context.contentByDate,
    });
    if (context.version !== expectedVersion) {
      const error = new Error("Trip version does not match If-Match");
      error.code = "VERSION_CONFLICT";
      error.status = 409;
      throw error;
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
