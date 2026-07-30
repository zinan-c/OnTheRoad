import {
  CoordinateAdjustmentError,
  type CoordinateAdjustmentService,
  type CoordinateInputMode,
  type Wgs84Point,
} from "../../../../../packages/application/src/location/adjust-coordinates.js";

function parseIfMatch(value: string | undefined): number {
  const match = value?.match(/^(?:W\/)?"([1-9][0-9]*)"$/u);
  if (!match) {
    throw new CoordinateAdjustmentError(
      "IF_MATCH_REQUIRED",
      "A quoted Location version is required in If-Match.",
      428,
    );
  }
  return Number(match[1]);
}

function response(location: Awaited<ReturnType<CoordinateAdjustmentService["repository"]["get"]>>) {
  return { location, etag: `"${location.version}"` };
}

export class LocationCoordinatesApi {
  constructor(readonly service: CoordinateAdjustmentService) {}

  async get(ownerId: string, locationId: string) {
    const location = await this.service.repository.get(ownerId, locationId);
    return {
      ...response(location),
      audit: await this.service.repository.audits(ownerId, locationId),
    };
  }

  async pick(
    ownerId: string,
    locationId: string,
    body: {
      readonly point: Wgs84Point;
      readonly reverse?: (point: Wgs84Point) => Promise<{
        readonly label: string;
        readonly formattedAddress?: string;
      }>;
    },
    headers: { readonly ifMatch?: string },
  ) {
    const result = await this.service.pickOnMap(
      ownerId,
      locationId,
      parseIfMatch(headers.ifMatch),
      body.point,
      body.reverse,
    );
    return { ...response(result.location), reverse: result.reverse };
  }

  async drag(
    ownerId: string,
    locationId: string,
    body: { readonly point: Wgs84Point; readonly inputMode?: CoordinateInputMode },
    headers: { readonly ifMatch?: string },
  ) {
    const location = await this.service.dragMarker(
      ownerId,
      locationId,
      parseIfMatch(headers.ifMatch),
      body.point,
      body.inputMode,
    );
    return response(location);
  }

  async manual(
    ownerId: string,
    locationId: string,
    body: { readonly point: Wgs84Point },
    headers: { readonly ifMatch?: string },
  ) {
    const location = await this.service.manuallyEnter(
      ownerId,
      locationId,
      parseIfMatch(headers.ifMatch),
      body.point,
    );
    return response(location);
  }
}
