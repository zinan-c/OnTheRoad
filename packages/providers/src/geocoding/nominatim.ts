import { assertWgs84Point } from "../contracts/validation.js";
import type { Wgs84Point } from "../contracts/dto.js";
import { GeocoderError } from "./errors.js";
import type {
  Geocoder,
  GeocodingFetch,
  GeocodingSearchRequest,
  NormalizedCandidate,
} from "./types.js";

const NOMINATIM_ENDPOINTS = Object.freeze({
  search: "/search",
  reverse: "/reverse",
});

export const NOMINATIM_ATTRIBUTION = "© OpenStreetMap contributors";

type NominatimAddress = Readonly<Record<string, unknown>>;

interface NominatimResult {
  readonly osm_type?: unknown;
  readonly osm_id?: unknown;
  readonly lat?: unknown;
  readonly lon?: unknown;
  readonly name?: unknown;
  readonly display_name?: unknown;
  readonly type?: unknown;
  readonly class?: unknown;
  readonly importance?: unknown;
  readonly licence?: unknown;
  readonly license?: unknown;
  readonly error?: unknown;
  readonly address?: unknown;
}

export interface NominatimGeocoderOptions {
  readonly profile: "public-online";
  readonly baseUrl?: string | URL;
  readonly userAgent: string;
  readonly contact: string;
  readonly language: string;
  readonly timeoutMs?: number;
  readonly fetch?: GeocodingFetch;
  readonly endpoints?: Partial<typeof NOMINATIM_ENDPOINTS>;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function address(value: unknown): NominatimAddress {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as NominatimAddress
    : {};
}

function firstAddressValue(value: NominatimAddress, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const result = text(value[key]);
    if (result) return result;
  }
  return undefined;
}

const COUNTRY_CODE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  aus: "au",
  aut: "at",
  bel: "be",
  can: "ca",
  chn: "cn",
  de: "de",
  deu: "de",
  esp: "es",
  fra: "fr",
  gbr: "gb",
  hkg: "hk",
  ind: "in",
  ita: "it",
  jpn: "jp",
  kor: "kr",
  nld: "nl",
  nzl: "nz",
  prt: "pt",
  sgp: "sg",
  swe: "se",
  twn: "tw",
  usa: "us",
});

function normalizedCountryCodes(codes: readonly string[] | undefined): string[] {
  return [...new Set((codes ?? [])
    .map((code) => code.trim().toLowerCase())
    .map((code) => COUNTRY_CODE_ALIASES[code] ?? code)
    .filter((code) => /^[a-z]{2}$/u.test(code)))]
    .sort();
}

function viewboxParameter(viewbox: readonly [number, number, number, number]): string {
  const [minimumLongitude, minimumLatitude, maximumLongitude, maximumLatitude] = viewbox;
  if (
    ![minimumLongitude, minimumLatitude, maximumLongitude, maximumLatitude].every(Number.isFinite)
    || minimumLongitude < -180
    || maximumLongitude > 180
    || minimumLatitude < -90
    || maximumLatitude > 90
    || minimumLongitude > maximumLongitude
    || minimumLatitude > maximumLatitude
  ) {
    throw new GeocoderError(
      "PROVIDER_RESPONSE_INVALID",
      "Nominatim viewbox is invalid",
      { provider: "nominatim", source: "client" },
    );
  }
  // GeocodingContext uses west,south,east,north; Nominatim uses
  // left,top,right,bottom.
  return [minimumLongitude, maximumLatitude, maximumLongitude, minimumLatitude].join(",");
}

function retryAfter(response: Response): number | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? Math.max(0, Math.ceil((timestamp - Date.now()) / 1_000))
    : undefined;
}

function results(payload: unknown): NominatimResult[] {
  if (!Array.isArray(payload)) {
    throw new GeocoderError(
      "PROVIDER_RESPONSE_INVALID",
      "Nominatim search response must be an array",
      { provider: "nominatim" },
    );
  }
  return payload as NominatimResult[];
}

function normalize(
  result: NominatimResult,
  profile: string,
  index: number,
): NormalizedCandidate {
  const osmType = text(result.osm_type)?.toLowerCase();
  const osmId = text(result.osm_id) ?? (typeof result.osm_id === "number" ? String(result.osm_id) : undefined);
  const latitude = number(result.lat);
  const longitude = number(result.lon);
  const resultAddress = address(result.address);
  const displayName = text(result.display_name);
  const label = text(result.name) ?? displayName;
  if (
    !osmType
    || !osmId
    || !/^\d+$/u.test(osmId)
    || !label
    || latitude === undefined
    || longitude === undefined
  ) {
    throw new GeocoderError(
      "PROVIDER_RESPONSE_INVALID",
      "Nominatim candidate shape is invalid",
      { provider: "nominatim" },
    );
  }
  const point: Wgs84Point = { longitude, latitude, crs: "WGS84" };
  try {
    assertWgs84Point(point);
  } catch {
    throw new GeocoderError(
      "PROVIDER_RESPONSE_INVALID",
      "Nominatim candidate coordinate is invalid",
      { provider: "nominatim" },
    );
  }
  const importance = number(result.importance);
  const providerScore = importance === undefined
    ? Math.max(0.1, 1 - index * 0.05)
    : Math.min(1, Math.max(0, importance));
  const licence = text(result.licence) ?? text(result.license) ?? NOMINATIM_ATTRIBUTION;
  const resultType = [text(result.class), text(result.type)].filter(Boolean).join(":") || undefined;
  const countryCode = text(resultAddress.country_code)?.toLowerCase();
  const city = firstAddressValue(resultAddress, ["city", "town", "village", "municipality"]);
  const district = firstAddressValue(resultAddress, ["city_district", "district", "suburb", "county"]);
  return {
    id: `osm:${osmType}:${osmId}`,
    label,
    point,
    ...(countryCode ? { countryCode } : {}),
    ...(displayName ? { formattedAddress: displayName } : {}),
    ...(city ? { city } : {}),
    ...(district ? { district } : {}),
    ...(resultType ? { type: resultType } : {}),
    providerScore,
    attribution: licence,
    selected: false,
    provider: "nominatim",
    mapProfile: profile,
  };
}

function endpoint(baseUrl: URL, path: string): string {
  if (/^https?:\/\//iu.test(path)) return new URL(path).href;
  const relativePath = path.replace(/^\/+/, "");
  const base = baseUrl.href.endsWith("/") ? baseUrl.href : `${baseUrl.href}/`;
  return new URL(relativePath, base).href;
}

export function createNominatimGeocoder(options: NominatimGeocoderOptions): Geocoder {
  if (!options.userAgent.trim()) {
    throw new GeocoderError(
      "PROVIDER_CREDENTIALS_MISSING",
      "Nominatim User-Agent is required",
      { provider: "nominatim" },
    );
  }
  if (!options.contact.trim()) {
    throw new GeocoderError(
      "PROVIDER_CREDENTIALS_MISSING",
      "Nominatim contact is required",
      { provider: "nominatim" },
    );
  }
  const baseUrl = new URL(options.baseUrl ?? "https://nominatim.openstreetmap.org");
  if (baseUrl.protocol !== "https:") {
    throw new GeocoderError(
      "PROVIDER_PROFILE_UNSUPPORTED",
      "Nominatim endpoint must use HTTPS",
      { provider: "nominatim" },
    );
  }
  const fetcher = options.fetch ?? (globalThis.fetch as GeocodingFetch);
  const configuredEndpoints = { ...NOMINATIM_ENDPOINTS, ...options.endpoints };
  const searchEndpoint = endpoint(baseUrl, configuredEndpoints.search);
  const reverseEndpoint = endpoint(baseUrl, configuredEndpoints.reverse);

  async function request(endpointUrl: string, parameters: URLSearchParams): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
    const url = new URL(endpointUrl);
    url.search = parameters.toString();
    try {
      const response = await fetcher(url, {
        headers: {
          accept: "application/json",
          "user-agent": options.userAgent,
        },
        signal: controller.signal,
      });
      if (response.status === 429) {
        const retryAfterSeconds = retryAfter(response);
        throw new GeocoderError(
          "PROVIDER_RATE_LIMITED",
          "Nominatim rate limit reached",
          {
            retryable: true,
            status: 429,
            provider: "nominatim",
            ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
          },
        );
      }
      if (!response.ok) {
        throw new GeocoderError(
          "PROVIDER_UNAVAILABLE",
          "Nominatim request failed",
          {
            retryable: response.status >= 500,
            status: response.status,
            provider: "nominatim",
          },
        );
      }
      try {
        return await response.json();
      } catch {
        throw new GeocoderError(
          "PROVIDER_RESPONSE_INVALID",
          "Nominatim returned invalid JSON",
          { provider: "nominatim" },
        );
      }
    } catch (error) {
      if (error instanceof GeocoderError) throw error;
      if (controller.signal.aborted) {
        throw new GeocoderError(
          "PROVIDER_TIMEOUT",
          "Nominatim request timed out",
          { retryable: true, provider: "nominatim" },
        );
      }
      throw new GeocoderError(
        "PROVIDER_UNAVAILABLE",
        "Nominatim transport failed",
        { retryable: true, provider: "nominatim" },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    provider: "nominatim",
    profile: options.profile,
    capabilities: () => ({ search: true, reverse: true, autocomplete: false, fuzzy: true }),
    async search(searchRequest: GeocodingSearchRequest) {
      if (searchRequest.trigger === "autocomplete" || searchRequest.trigger === "batch") {
        throw new GeocoderError(
          "PROVIDER_TRIGGER_UNSUPPORTED",
          "Nominatim only supports explicit search",
          { provider: "nominatim", source: "client" },
        );
      }
      const query = searchRequest.query.normalize("NFKC").trim().replace(/\s+/gu, " ");
      if (!query) return [];
      const parameters = new URLSearchParams({
        format: "jsonv2",
        q: query,
        limit: String(Math.min(Math.max(searchRequest.limit ?? 5, 1), 10)),
        "addressdetails": "1",
        email: options.contact,
        "accept-language": searchRequest.locale ?? options.language,
      });
      const countries = normalizedCountryCodes(searchRequest.context?.countryCodes);
      if (countries.length > 0) parameters.set("countrycodes", countries.join(","));
      if (searchRequest.context?.viewbox) {
        parameters.set("viewbox", viewboxParameter(searchRequest.context.viewbox));
      }
      return results(await request(searchEndpoint, parameters))
        .map((result, index) => normalize(result, options.profile, index));
    },
    async reverse(point: Wgs84Point, locale?: string) {
      try {
        assertWgs84Point(point);
      } catch {
        throw new GeocoderError(
          "PROVIDER_RESPONSE_INVALID",
          "Nominatim reverse coordinate is invalid",
          { provider: "nominatim", source: "client" },
        );
      }
      const parameters = new URLSearchParams({
        format: "jsonv2",
        lat: String(point.latitude),
        lon: String(point.longitude),
        zoom: "18",
        addressdetails: "1",
        email: options.contact,
        "accept-language": locale ?? options.language,
      });
      const payload = await request(reverseEndpoint, parameters);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
      if (text((payload as NominatimResult).error)) return null;
      return normalize(payload as NominatimResult, options.profile, 0);
    },
  };
}
