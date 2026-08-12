import { assertWgs84Point } from "../contracts/validation.js";
import type { Wgs84Point } from "../contracts/dto.js";
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

const PI = Math.PI;
const EARTH_SEMIMAJOR_AXIS = 6_378_245;
const ECCENTRICITY_SQUARED = 0.006693421622965943;

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

function outsideChina(longitude: number, latitude: number): boolean {
  return longitude < 72.004
    || longitude > 137.8347
    || latitude < 0.8293
    || latitude > 55.8271;
}

function transformLatitude(longitude: number, latitude: number): number {
  let result = -100 + (2 * longitude) + (3 * latitude)
    + (0.2 * latitude * latitude)
    + (0.1 * longitude * latitude)
    + (0.2 * Math.sqrt(Math.abs(longitude)));
  result += ((20 * Math.sin(6 * longitude * PI)) + (20 * Math.sin(2 * longitude * PI))) * 2 / 3;
  result += ((20 * Math.sin(latitude * PI)) + (40 * Math.sin(latitude / 3 * PI))) * 2 / 3;
  result += ((160 * Math.sin(latitude / 12 * PI)) + (320 * Math.sin(latitude * PI / 30))) * 2 / 3;
  return result;
}

function transformLongitude(longitude: number, latitude: number): number {
  let result = 300 + longitude + (2 * latitude)
    + (0.1 * longitude * longitude)
    + (0.1 * longitude * latitude)
    + (0.1 * Math.sqrt(Math.abs(longitude)));
  result += ((20 * Math.sin(6 * longitude * PI)) + (20 * Math.sin(2 * longitude * PI))) * 2 / 3;
  result += ((20 * Math.sin(longitude * PI)) + (40 * Math.sin(longitude / 3 * PI))) * 2 / 3;
  result += ((150 * Math.sin(longitude / 12 * PI)) + (300 * Math.sin(longitude / 30 * PI))) * 2 / 3;
  return result;
}

export function wgs84ToGcj02(point: Wgs84Point): Wgs84Point {
  assertWgs84Point(point);
  if (outsideChina(point.longitude, point.latitude)) return point;
  let latitudeDelta = transformLatitude(point.longitude - 105, point.latitude - 35);
  let longitudeDelta = transformLongitude(point.longitude - 105, point.latitude - 35);
  const radianLatitude = point.latitude / 180 * PI;
  let magic = Math.sin(radianLatitude);
  magic = 1 - (ECCENTRICITY_SQUARED * magic * magic);
  const rootMagic = Math.sqrt(magic);
  latitudeDelta = latitudeDelta * 180
    / ((EARTH_SEMIMAJOR_AXIS * (1 - ECCENTRICITY_SQUARED)) / (magic * rootMagic) * PI);
  longitudeDelta = longitudeDelta * 180
    / (EARTH_SEMIMAJOR_AXIS / rootMagic * Math.cos(radianLatitude) * PI);
  return {
    longitude: point.longitude + longitudeDelta,
    latitude: point.latitude + latitudeDelta,
    crs: "WGS84",
  };
}

export function gcj02ToWgs84(point: Wgs84Point): Wgs84Point {
  assertWgs84Point(point);
  if (outsideChina(point.longitude, point.latitude)) return point;
  let minimumLongitude = point.longitude - 0.02;
  let maximumLongitude = point.longitude + 0.02;
  let minimumLatitude = point.latitude - 0.02;
  let maximumLatitude = point.latitude + 0.02;
  let candidate = point;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    candidate = {
      longitude: (minimumLongitude + maximumLongitude) / 2,
      latitude: (minimumLatitude + maximumLatitude) / 2,
      crs: "WGS84",
    };
    const converted = wgs84ToGcj02(candidate);
    const longitudeDelta = converted.longitude - point.longitude;
    const latitudeDelta = converted.latitude - point.latitude;
    if (Math.abs(longitudeDelta) < 1e-7 && Math.abs(latitudeDelta) < 1e-7) break;
    if (longitudeDelta > 0) maximumLongitude = candidate.longitude;
    else minimumLongitude = candidate.longitude;
    if (latitudeDelta > 0) maximumLatitude = candidate.latitude;
    else minimumLatitude = candidate.latitude;
  }
  return candidate;
}

function singleText(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  return Array.isArray(value) ? value.find((entry) => entry.trim()) : undefined;
}

function parseLocation(value: string | undefined): Wgs84Point {
  const [longitudeText, latitudeText] = value?.split(",") ?? [];
  const gcj02 = {
    longitude: Number(longitudeText),
    latitude: Number(latitudeText),
    crs: "WGS84" as const,
  };
  try {
    assertWgs84Point(gcj02);
  } catch {
    throw new GeocoderError(
      "PROVIDER_RESPONSE_INVALID",
      "AMAP candidate coordinate is invalid",
      { provider: "amap" },
    );
  }
  return gcj02ToWgs84(gcj02);
}

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
      const payload = await response.json() as AmapPayload;
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
