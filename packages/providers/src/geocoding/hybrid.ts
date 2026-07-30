import type { Wgs84Point } from "../contracts/dto.js";
import { GeocoderError } from "./errors.js";
import type { Geocoder, GeocodingSearchRequest } from "./types.js";

export interface HybridGeocoderOptions {
  readonly amap: Geocoder;
  readonly here: Geocoder;
}

function isChinaCountryCode(code: string): boolean {
  return ["cn", "chn"].includes(code.trim().toLowerCase());
}

function searchProvider(options: HybridGeocoderOptions, request: GeocodingSearchRequest): Geocoder {
  const countries = request.context?.countryCodes ?? [];
  return countries.some(isChinaCountryCode) ? options.amap : options.here;
}

function reverseProvider(options: HybridGeocoderOptions, point: Wgs84Point): Geocoder {
  const inChinaBounds = point.longitude >= 72.004
    && point.longitude <= 137.8347
    && point.latitude >= 0.8293
    && point.latitude <= 55.8271;
  return inChinaBounds ? options.amap : options.here;
}

export function createHybridGeocoder(options: HybridGeocoderOptions): Geocoder {
  if (options.amap.provider !== "amap" || options.here.provider !== "here") {
    throw new GeocoderError(
      "PROVIDER_PROFILE_UNSUPPORTED",
      "Hybrid profile requires explicit AMAP and HERE adapters",
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
