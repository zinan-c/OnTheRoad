import type { Wgs84Point } from "../contracts/dto.js";
import { GeocoderError } from "./errors.js";
import type { Geocoder, GeocodingSearchRequest } from "./types.js";

export interface HybridGeocoderOptions {
  readonly amap: Geocoder;
  readonly mapbox: Geocoder;
}

function isChinaCountryCode(code: string): boolean {
  return ["cn", "chn"].includes(code.trim().toLowerCase());
}

function isChinaPoint(longitude: number, latitude: number): boolean {
  return longitude >= 72.004
    && longitude <= 137.8347
    && latitude >= 0.8293
    && latitude <= 55.8271;
}

function searchProvider(options: HybridGeocoderOptions, request: GeocodingSearchRequest): Geocoder {
  const countries = request.context?.countryCodes ?? [];
  if (countries.some(isChinaCountryCode)) return options.amap;
  const proximity = request.context?.proximity;
  if (proximity) {
    const [longitude, latitude] = "longitude" in proximity
      ? [proximity.longitude, proximity.latitude]
      : proximity;
    if (isChinaPoint(longitude, latitude)) return options.amap;
  }
  const viewbox = request.context?.viewbox;
  if (viewbox) {
    const [west, south, east, north] = viewbox;
    if (isChinaPoint((west + east) / 2, (south + north) / 2)) return options.amap;
  }
  return options.mapbox;
}

function reverseProvider(options: HybridGeocoderOptions, point: Wgs84Point): Geocoder {
  return isChinaPoint(point.longitude, point.latitude) ? options.amap : options.mapbox;
}

export function createHybridGeocoder(options: HybridGeocoderOptions): Geocoder {
  if (options.amap.provider !== "amap" || options.mapbox.provider !== "mapbox") {
    throw new GeocoderError(
      "PROVIDER_PROFILE_UNSUPPORTED",
      "Hybrid profile requires explicit AMAP and Mapbox adapters",
      { provider: "hybrid" },
    );
  }
  return {
    provider: "hybrid",
    profile: "hybrid",
    capabilities: () => ({ search: true, reverse: true, autocomplete: false, fuzzy: true }),
    search(request) {
      return searchProvider(options, request).search(request);
    },
    reverse(point, locale) {
      return reverseProvider(options, point).reverse(point, locale);
    },
  };
}
