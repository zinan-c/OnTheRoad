import { assertWgs84Point } from "../contracts/validation.js";
import type { Wgs84Point } from "../contracts/dto.js";
import { GeocoderError } from "./errors.js";
import type {
  Geocoder,
  GeocodingFetch,
  GeocodingSearchRequest,
  NormalizedCandidate,
} from "./types.js";

const MAPBOX_ENDPOINTS = Object.freeze({
  forward: "https://api.mapbox.com/search/geocode/v6/forward",
  reverse: "https://api.mapbox.com/search/geocode/v6/reverse",
});

export const MAPBOX_GEOCODING_ATTRIBUTION = "© Mapbox";

type MapboxProperties = Readonly<Record<string, unknown>>;

interface MapboxFeature {
  readonly id?: unknown;
  readonly geometry?: unknown;
  readonly properties?: unknown;
}

interface MapboxFeatureCollection {
  readonly type?: unknown;
  readonly features?: unknown;
}

export interface MapboxGeocoderOptions {
  /** The permanent Geocoding API token. It must only be constructed server-side. */
  readonly accessToken?: string;
  /** Alias retained for provider adapter symmetry; never expose this to Web. */
  readonly apiKey?: string;
  readonly profile: "mapbox-permanent";
  readonly language: string;
  readonly timeoutMs?: number;
  readonly fetch?: GeocodingFetch;
  readonly endpoints?: {
    readonly forward?: string;
    readonly reverse?: string;
  };
}

const ISO3_TO_ISO2: Readonly<Record<string, string>> = Object.freeze({
  aus: "au",
  can: "ca",
  chn: "cn",
  deu: "de",
  esp: "es",
  fra: "fr",
  gbr: "gb",
  idn: "id",
  ind: "in",
  ita: "it",
  jpn: "jp",
  kor: "kr",
  mys: "my",
  phl: "ph",
  sgp: "sg",
  tha: "th",
  usa: "us",
  vnm: "vn",
});

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function object(value: unknown): MapboxProperties {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as MapboxProperties
    : {};
}

function number(value: unknown): number | undefined {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function invalidPayload(message: string): GeocoderError {
  return new GeocoderError("PROVIDER_RESPONSE_INVALID", message, { provider: "mapbox" });
}

function candidatePoint(feature: MapboxFeature, properties: MapboxProperties): Wgs84Point {
  const geometry = object(feature.geometry);
  const geometryCoordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates : undefined;
  const propertyCoordinates = object(properties.coordinates);
  const longitude = number(geometryCoordinates?.[0] ?? propertyCoordinates.longitude);
  const latitude = number(geometryCoordinates?.[1] ?? propertyCoordinates.latitude);
  if (longitude === undefined || latitude === undefined) throw invalidPayload("Mapbox candidate coordinates are missing");
  const point: Wgs84Point = { longitude, latitude, crs: "WGS84" };
  try {
    assertWgs84Point(point);
  } catch {
    throw invalidPayload("Mapbox candidate coordinates are invalid");
  }
  return point;
}

function contextValue(context: MapboxProperties, key: string): MapboxProperties {
  return object(context[key]);
}

function confidence(properties: MapboxProperties, index: number): number {
  const matchCode = object(properties.match_code);
  const level = text(matchCode.confidence);
  if (level === "high") return 0.95;
  if (level === "medium") return 0.75;
  if (level === "low") return 0.5;
  const direct = number(properties.confidence);
  if (direct !== undefined) return Math.max(0, Math.min(1, direct));
  return Math.max(0.1, 1 - index * 0.05);
}

function normalizeFeature(
  feature: unknown,
  profile: string,
  index: number,
): NormalizedCandidate {
  const rawFeature = object(feature) as MapboxFeature;
  const properties = object(rawFeature.properties);
  const context = object(properties.context);
  const id = text(properties.mapbox_id) ?? text(rawFeature.id);
  const label = text(properties.name_preferred)
    ?? text(properties.name)
    ?? text(properties.full_address)
    ?? text(properties.place_formatted);
  if (!id || !label) throw invalidPayload("Mapbox candidate identity is invalid");
  const point = candidatePoint(rawFeature, properties);
  const country = contextValue(context, "country");
  const place = contextValue(context, "place");
  const locality = contextValue(context, "locality");
  const district = contextValue(context, "district");
  const countryCode = text(country.country_code)?.toLowerCase();
  const city = text(place.name) ?? text(locality.name);
  const districtName = text(district.name);
  const formattedAddress = text(properties.full_address)
    ?? text(properties.place_formatted)
    ?? text(properties.address_line1);
  const type = text(properties.feature_type) ?? text(properties.accuracy);
  return {
    id,
    label,
    point,
    ...(countryCode ? { countryCode } : {}),
    ...(formattedAddress ? { formattedAddress } : {}),
    ...(city ? { city } : {}),
    ...(districtName ? { district: districtName } : {}),
    ...(type ? { type } : {}),
    providerScore: confidence(properties, index),
    attribution: MAPBOX_GEOCODING_ATTRIBUTION,
    selected: false,
    provider: "mapbox",
    mapProfile: profile,
  };
}

function features(payload: unknown): MapboxFeature[] {
  const collection = object(payload) as MapboxFeatureCollection;
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw invalidPayload("Mapbox response must be a GeoJSON FeatureCollection");
  }
  return collection.features as MapboxFeature[];
}

function countryCodes(codes: readonly string[] | undefined): string | undefined {
  if (!codes || codes.length === 0) return undefined;
  const mapped = codes.map((code) => {
    const normalized = code.trim().toLowerCase();
    if (/^[a-z]{2}$/u.test(normalized)) return normalized;
    const iso2 = ISO3_TO_ISO2[normalized];
    if (iso2) return iso2;
    throw new GeocoderError(
      "PROVIDER_REQUEST_INVALID",
      "Mapbox country context must use ISO 3166-1 alpha-2 or a supported alpha-3 code",
      { provider: "mapbox", source: "client" },
    );
  });
  return [...new Set(mapped)].sort().join(",");
}

function coordinatePair(value: Wgs84Point | readonly [number, number]): string {
  let point: Wgs84Point;
  if (Array.isArray(value)) {
    point = { longitude: Number(value[0]), latitude: Number(value[1]), crs: "WGS84" };
  } else {
    point = value as Wgs84Point;
  }
  try {
    assertWgs84Point(point);
  } catch {
    throw new GeocoderError(
      "PROVIDER_REQUEST_INVALID",
      "Mapbox proximity must be a valid WGS84 point",
      { provider: "mapbox", source: "client" },
    );
  }
  return `${point.longitude},${point.latitude}`;
}

function bbox(value: readonly [number, number, number, number]): string {
  const [west, south, east, north] = value;
  if (![west, south, east, north].every(Number.isFinite)
    || west < -180 || east > 180 || south < -90 || north > 90
    || west > east || south > north) {
    throw new GeocoderError(
      "PROVIDER_REQUEST_INVALID",
      "Mapbox viewbox must be west,south,east,north within WGS84 bounds",
      { provider: "mapbox", source: "client" },
    );
  }
  return value.join(",");
}

function retryAfter(response: Response): number | undefined {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function createMapboxGeocoder(options: MapboxGeocoderOptions): Geocoder {
  const accessToken = (options.accessToken ?? options.apiKey ?? "").trim();
  if (!accessToken) {
    throw new GeocoderError(
      "PROVIDER_CREDENTIALS_MISSING",
      "Mapbox Geocoding access token is required",
      { provider: "mapbox" },
    );
  }
  const endpoints = { ...MAPBOX_ENDPOINTS, ...options.endpoints };
  for (const endpoint of Object.values(endpoints)) {
    if (!endpoint.startsWith("https://")) {
      throw new GeocoderError(
        "PROVIDER_PROFILE_UNSUPPORTED",
        "Mapbox Geocoding endpoints must use HTTPS",
        { provider: "mapbox" },
      );
    }
  }
  const fetcher = options.fetch ?? (globalThis.fetch as GeocodingFetch);
  const timeoutMs = options.timeoutMs ?? 5_000;

  async function request(endpoint: string, parameters: URLSearchParams): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const url = new URL(endpoint);
    parameters.set("access_token", accessToken);
    url.search = parameters.toString();
    try {
      const response = await fetcher(url, {
        headers: { accept: "application/geo+json, application/json" },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw new GeocoderError(
          "PROVIDER_CREDENTIALS_INVALID",
          "Mapbox credentials were rejected",
          { status: response.status, provider: "mapbox" },
        );
      }
      if (response.status === 429) {
        const retryAfterSeconds = retryAfter(response);
        throw new GeocoderError(
          "PROVIDER_RATE_LIMITED",
          "Mapbox Geocoding rate limit reached",
          {
            retryable: true,
            status: response.status,
            provider: "mapbox",
            ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
          },
        );
      }
      if (response.status === 408 || response.status === 504) {
        throw new GeocoderError(
          "PROVIDER_TIMEOUT",
          "Mapbox Geocoding request timed out",
          { retryable: true, status: response.status, provider: "mapbox" },
        );
      }
      if (!response.ok) {
        throw new GeocoderError(
          "PROVIDER_UNAVAILABLE",
          "Mapbox Geocoding request failed",
          { retryable: response.status >= 500, status: response.status, provider: "mapbox" },
        );
      }
      try {
        return await response.json();
      } catch {
        throw invalidPayload("Mapbox Geocoding returned invalid JSON");
      }
    } catch (error) {
      if (error instanceof GeocoderError) throw error;
      if (controller.signal.aborted) {
        throw new GeocoderError(
          "PROVIDER_TIMEOUT",
          "Mapbox Geocoding request timed out",
          { retryable: true, provider: "mapbox" },
        );
      }
      throw new GeocoderError(
        "PROVIDER_UNAVAILABLE",
        "Mapbox Geocoding transport failed",
        { retryable: true, provider: "mapbox" },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    provider: "mapbox",
    profile: options.profile,
    capabilities: () => ({ search: true, reverse: true, autocomplete: false, fuzzy: true }),
    async search(requestInput: GeocodingSearchRequest) {
      if (requestInput.trigger === "autocomplete") {
        throw new GeocoderError(
          "PROVIDER_TRIGGER_UNSUPPORTED",
          "Mapbox Geocoding autocomplete is disabled; use explicit search",
          { provider: "mapbox", source: "client" },
        );
      }
      const query = requestInput.query.normalize("NFKC").trim().replace(/\s+/gu, " ");
      if (!query) return [];
      const parameters = new URLSearchParams({
        q: query,
        format: "geojson",
        permanent: "true",
        autocomplete: "false",
        language: requestInput.locale ?? options.language,
        limit: String(Math.min(Math.max(requestInput.limit ?? 5, 1), 10)),
      });
      const countries = countryCodes(requestInput.context?.countryCodes);
      if (countries) parameters.set("country", countries);
      if (requestInput.context?.viewbox) parameters.set("bbox", bbox(requestInput.context.viewbox));
      if (requestInput.context?.proximity) parameters.set("proximity", coordinatePair(requestInput.context.proximity));
      return features(await request(endpoints.forward, parameters))
        .map((feature, index) => normalizeFeature(feature, options.profile, index));
    },
    async reverse(point: Wgs84Point, locale?: string) {
      try {
        assertWgs84Point(point);
      } catch {
        throw new GeocoderError(
          "PROVIDER_REQUEST_INVALID",
          "A valid WGS84 point is required",
          { provider: "mapbox", source: "client" },
        );
      }
      const parameters = new URLSearchParams({
        longitude: String(point.longitude),
        latitude: String(point.latitude),
        format: "geojson",
        permanent: "true",
        language: locale ?? options.language,
      });
      const feature = features(await request(endpoints.reverse, parameters))[0];
      return feature ? normalizeFeature(feature, options.profile, 0) : null;
    },
  };
}
