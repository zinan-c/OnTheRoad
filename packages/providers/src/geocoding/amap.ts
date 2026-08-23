import type { Wgs84Point } from "../contracts/dto.js";
import {
  assertGcj02Point,
  gcj02ToWgs84,
  wgs84ToGcj02,
  type Gcj02Point,
} from "../coordinates/gcj02.js";
import { assertWgs84Point } from "../contracts/validation.js";
import { GeocoderError } from "./errors.js";
import type {
  Geocoder,
  GeocodingFetch,
  GeocodingSearchRequest,
  NormalizedCandidate,
} from "./types.js";

const AMAP_ENDPOINTS = Object.freeze({
  search: "https://restapi.amap.com/v3/place/text",
  reverse: "https://restapi.amap.com/v3/geocode/regeo",
});

interface AmapPoi {
  id?: string;
  name?: string;
  address?: string | string[];
  location?: string;
  pname?: string;
  cityname?: string | string[];
  adname?: string | string[];
}

interface AmapPayload {
  status?: string;
  info?: string;
  infocode?: string;
  pois?: AmapPoi[];
  regeocode?: {
    formatted_address?: string;
    addressComponent?: {
      province?: string;
      city?: string | string[];
      district?: string;
    };
  };
}

export interface AmapGeocoderOptions {
  readonly profile: "cn-primary";
  readonly apiKey: string;
  readonly language: string;
  readonly timeoutMs?: number;
  readonly fetch?: GeocodingFetch;
  readonly endpoints?: Partial<typeof AMAP_ENDPOINTS>;
}

function singleText(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  return Array.isArray(value) ? value.find((entry) => entry.trim()) : undefined;
}

function parseLocation(value: string | undefined): Wgs84Point {
  const [longitudeText, latitudeText] = value?.split(",") ?? [];
  const gcj02: Gcj02Point = {
    longitude: Number(longitudeText),
    latitude: Number(latitudeText),
    crs: "GCJ02",
  };
  try {
    assertGcj02Point(gcj02);
  } catch {
    throw new GeocoderError(
      "PROVIDER_RESPONSE_INVALID",
      "AMAP candidate coordinate is invalid",
      { provider: "amap" },
    );
  }
  return gcj02ToWgs84(gcj02);
}

export { gcj02ToWgs84, wgs84ToGcj02 } from "../coordinates/gcj02.js";

function normalizePoi(poi: AmapPoi, profile: string, index: number): NormalizedCandidate {
  if (!poi.id || !poi.name) {
    throw new GeocoderError(
      "PROVIDER_RESPONSE_INVALID",
      "AMAP candidate shape is invalid",
      { provider: "amap" },
    );
  }
  const address = singleText(poi.address);
  const city = singleText(poi.cityname);
  return {
    id: poi.id,
    label: poi.name,
    point: parseLocation(poi.location),
    countryCode: "chn",
    ...(address ? { formattedAddress: address } : {}),
    ...(city ? { city } : {}),
    providerScore: Math.max(0.1, 1 - (index * 0.05)),
    attribution: "© 高德地图",
    selected: false,
    provider: "amap",
    mapProfile: profile,
  };
}

function retryAfter(response: Response): number | undefined {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export function createAmapGeocoder(options: AmapGeocoderOptions): Geocoder {
  if (!options.apiKey.trim()) {
    throw new GeocoderError(
      "PROVIDER_CREDENTIALS_MISSING",
      "AMAP API key is required",
      { provider: "amap" },
    );
  }
  const fetcher = options.fetch ?? (globalThis.fetch as GeocodingFetch);
  const endpoints = { ...AMAP_ENDPOINTS, ...options.endpoints };

  async function request(endpoint: string, parameters: URLSearchParams): Promise<AmapPayload> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 2_000);
    const url = new URL(endpoint);
    parameters.set("key", options.apiKey);
    url.search = parameters.toString();
    try {
      const response = await fetcher(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw new GeocoderError(
          "PROVIDER_CREDENTIALS_INVALID",
          "AMAP credentials were rejected",
          { status: response.status, provider: "amap" },
        );
      }
      if (response.status === 429) {
        const retryAfterSeconds = retryAfter(response);
        throw new GeocoderError(
          "PROVIDER_RATE_LIMITED",
          "AMAP rate limit reached",
          {
            retryable: true,
            status: 429,
            provider: "amap",
            ...(retryAfterSeconds === undefined
              ? {}
              : { retryAfterSeconds }),
          },
        );
      }
      if (!response.ok) {
        throw new GeocoderError(
          "PROVIDER_UNAVAILABLE",
          "AMAP request failed",
          { retryable: response.status >= 500, status: response.status, provider: "amap" },
        );
      }
      let payload: AmapPayload;
      try {
        payload = await response.json() as AmapPayload;
      } catch {
        throw new GeocoderError(
          "PROVIDER_RESPONSE_INVALID",
          "AMAP returned invalid JSON",
          { provider: "amap", status: response.status },
        );
      }
      if (payload.status !== "1") {
        const code = payload.infocode ?? "";
        if (["10001", "10002", "10003", "10009"].includes(code)) {
          throw new GeocoderError(
            "PROVIDER_CREDENTIALS_INVALID",
            "AMAP credentials were rejected",
            { provider: "amap" },
          );
        }
        if (["10004", "10021", "10044"].includes(code)) {
          throw new GeocoderError(
            "PROVIDER_RATE_LIMITED",
            "AMAP rate limit reached",
            { retryable: true, provider: "amap" },
          );
        }
        throw new GeocoderError(
          "PROVIDER_UNAVAILABLE",
          "AMAP returned an unsuccessful response",
          { retryable: true, provider: "amap" },
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof GeocoderError) throw error;
      if (controller.signal.aborted) {
        throw new GeocoderError(
          "PROVIDER_TIMEOUT",
          "AMAP request timed out",
          { retryable: true, provider: "amap" },
        );
      }
      throw new GeocoderError(
        "PROVIDER_UNAVAILABLE",
        "AMAP transport failed",
        { retryable: true, provider: "amap" },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    provider: "amap",
    profile: options.profile,
    capabilities: () => ({ search: true, reverse: true, autocomplete: false, fuzzy: true }),
    async search(searchRequest: GeocodingSearchRequest) {
      if (searchRequest.trigger === "autocomplete") {
        throw new GeocoderError(
          "PROVIDER_TRIGGER_UNSUPPORTED",
          "AMAP autocomplete trigger is disabled by policy",
          { provider: "amap" },
        );
      }
      const query = searchRequest.query.normalize("NFKC").trim().replace(/\s+/gu, " ");
      if (!query) return [];
      const parameters = new URLSearchParams({
        keywords: query,
        offset: String(Math.min(Math.max(searchRequest.limit ?? 5, 1), 20)),
        page: "1",
        extensions: "base",
      });
      if (searchRequest.locale) parameters.set("language", searchRequest.locale.startsWith("en") ? "en" : "zh-CN");
      const payload = await request(endpoints.search, parameters);
      if (!Array.isArray(payload.pois)) {
        throw new GeocoderError(
          "PROVIDER_RESPONSE_INVALID",
          "AMAP response pois must be an array",
          { provider: "amap" },
        );
      }
      return payload.pois.map((poi, index) => normalizePoi(poi, options.profile, index));
    },
    async reverse(point, locale) {
      try {
        assertWgs84Point(point);
      } catch {
        throw new GeocoderError("PROVIDER_REQUEST_INVALID", "A valid WGS84 point is required", {
          source: "client",
          provider: "amap",
        });
      }
      const gcj02 = wgs84ToGcj02(point);
      const parameters = new URLSearchParams({
        location: `${gcj02.longitude},${gcj02.latitude}`,
        extensions: "base",
      });
      if (locale) parameters.set("language", locale.startsWith("en") ? "en" : "zh-CN");
      const payload = await request(endpoints.reverse, parameters);
      const address = payload.regeocode?.formatted_address;
      if (!address) return null;
      const component = payload.regeocode?.addressComponent;
      const city = singleText(component?.city);
      return {
        id: `amap:reverse:${gcj02.longitude},${gcj02.latitude}`,
        label: address,
        formattedAddress: address,
        point,
        countryCode: "chn",
        ...(city ? { city } : {}),
        providerScore: 1,
        attribution: "© 高德地图",
        selected: false,
        provider: "amap",
        mapProfile: options.profile,
      };
    },
  };
}
