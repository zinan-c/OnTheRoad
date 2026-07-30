// @ts-nocheck
export class PostgresCoordinateRepository {
  constructor({ locationRepository }) {
    this.locationRepository = locationRepository;
  }

  get(ownerId, locationId) {
    return this.locationRepository.getOwned(ownerId, locationId);
  }

  async manualAdjust(input) {
    return this.locationRepository.adjustCoordinates(
      input.ownerId,
      input.locationId,
      input.expectedVersion,
      {
        point: input.point,
        provider: "manual",
        sourceCrs: "EPSG:4326",
        ...(input.reverseResult?.label ? { name: input.reverseResult.label } : {}),
        ...(input.reverseResult?.formattedAddress
          ? { formattedAddress: input.reverseResult.formattedAddress }
          : {}),
      },
      {
        action: input.action,
        inputMode: input.inputMode,
        reverseStatus: input.reverseStatus,
      },
    );
  }

  async applyGeocodeIfCurrent(input) {
    try {
      const location = await this.locationRepository.transition(
        input.ownerId,
        input.locationId,
        input.expectedVersion,
        "resolved",
        {
          point: input.point,
          name: input.label,
          provider: "geocoder",
          sourceCrs: "EPSG:4326",
        },
      );
      return { affectedRows: 1, location };
    } catch (error) {
      if (
        error?.code === "LOCATION_VERSION_CONFLICT"
        || error?.code === "STALE_GEOCODING_RESULT"
      ) {
        return { affectedRows: 0 };
      }
      throw error instanceof Error
        ? error
        : new Error("Coordinate write failed.");
    }
  }

  audits(ownerId, locationId) {
    return this.locationRepository.listCoordinateAudits(ownerId, locationId);
  }
}
