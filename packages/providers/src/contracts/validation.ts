import { ProviderError } from "./errors.js";
import type { Wgs84Point } from "./dto.js";

export function assertWgs84Point(point: Wgs84Point): void {
  if (
    point.crs !== "WGS84"
    || !Number.isFinite(point.longitude)
    || !Number.isFinite(point.latitude)
    || point.longitude < -180
    || point.longitude > 180
    || point.latitude < -90
    || point.latitude > 90
  ) {
    throw new ProviderError(
      "PROVIDER_REQUEST_INVALID",
      "A valid WGS84 point is required",
      false,
    );
  }
}
