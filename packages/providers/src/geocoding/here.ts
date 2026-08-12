import { assertWgs84Point } from "../contracts/validation.js";
import { GeocoderError } from "./errors.js";
import type {
  Geocoder,
  GeocodingFetch,
  GeocodingSearchRequest,
  NormalizedCandidate,
} from "./types.js";
import type { Wgs84Point } from "../contracts/dto.js";

const HERE_ENDPOINTS = Object.freeze({
  geocode: "https://geocode.search.hereapi.com/v1/geocode",
  discover: "https://discover.search.hereapi.com/v1/discover",
  reverse: "https://revgeocode.search.hereapi.com/v1/revgeocode",
});

interface HereItem {
  id?: string;
  title?: string;
  resultType?: string;
  position?: { lat?: number; lng?: number };
  address?: { label?: string; countryCode?: string; city?: string };
  scoring?: { queryScore?: number };
}

export interface HereGeocoderOptions {
  readonly profile: "commercial-required";
  readonly apiKey: string;
  readonly language: string;
  readonly timeoutMs?: number;
  readonly fetch?: GeocodingFetch;
  readonly endpoints?: Partial<typeof HERE_ENDPOINTS>;
}

function items(payload: unknown): HereItem[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new GeocoderError("PROVIDER_RESPONSE_INVALID", "HERE response must be an object");
  }
  const value = (payload as { items?: unknown }).items;
  if (!Array.isArray(value)) {
    throw new GeocoderError("PROVIDER_RESPONSE_INVALID", "HERE response items must be an array");
  }
  return value as HereItem[];
}

function normalize(item: HereItem, profile: string, contextCountries: readonly string[] = []): NormalizedCandidate {
  const longitude = Number(item.position?.lng);
  const latitude = Number(item.position?.lat);
  const label = item.title ?? item.address?.label;
  if (!item.id || !label || !Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new GeocoderError("PROVIDER_RESPONSE_INVALID", "HERE candidate shape is invalid");
  }
  const point: Wgs84Point = { longitude, latitude, crs: "WGS84" };
  try {
    assertWgs84Point(point);
  } catch {
    throw new GeocoderError("PROVIDER_RESPONSE_INVALID", "HERE candidate coordinate is invalid");
  }
  const countryCode = item.address?.countryCode?.toLowerCase();
  const contextMatch = countryCode
    ? contextCountries.some((code) => code.toLowerCase() === countryCode)
    : false;
  return {
    id: item.id,
    label,
    point,
    ...(countryCode ? { countryCode } : {}),
    ...(item.address?.label ? { formattedAddress: item.address.label } : {}),
    ...(item.address?.city ? { city: item.address.city } : {}),
    ...(item.resultType ? { type: item.resultType } : {}),
    providerScore: Math.min(1, (item.scoring?.queryScore ?? 0.5) + (contextMatch ? 0.2 : 0)),
    attribution: "© HERE",
    selected: false,
    provider: "here",
    mapProfile: profile,
  };
}

function retryAfter(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export function createHereGeocoder(options: HereGeocoderOptions): Geocoder {
  if (!options.apiKey.trim()) {
    throw new GeocoderError("PROVIDER_CREDENTIALS_MISSING", "HERE API key is required");
  }
  const fetcher = options.fetch ?? (globalThis.fetch as GeocodingFetch);
  const endpoints = { ...HERE_ENDPOINTS, ...options.endpoints };

  async function request(endpoint: string, parameters: URLSearchParams): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 2_000);
    const url = new URL(endpoint);
    parameters.set("apiKey", options.apiKey);
    if (!parameters.has("lang")) parameters.set("lang", options.language);
    url.search = parameters.toString();
    try {
      const response = await fetcher(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw new GeocoderError("PROVIDER_CREDENTIALS_INVALID", "HERE credentials were rejected", {
          status: response.status,
        });
      }
      if (response.status === 429) {
        const retryAfterSeconds = retryAfter(response);
        throw new GeocoderError("PROVIDER_RATE_LIMITED", "HERE rate limit reached", {
          retryable: true,
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
          status: 429,
        });
      }
      if (!response.ok) {
        throw new GeocoderError("PROVIDER_UNAVAILABLE", "HERE request failed", {
          retryable: response.status >= 500,
          status: response.status,
        });
      }
      return response.json();
    } catch (error) {
      if (error instanceof GeocoderError) throw error;
      if (controller.signal.aborted) {
        throw new GeocoderError("PROVIDER_TIMEOUT", "HERE request timed out", { retryable: true });
      }
      throw new GeocoderError("PROVIDER_UNAVAILABLE", "HERE transport failed", { retryable: true });
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    provider: "here",
    profile: options.profile,
    capabilities: () => ({ search: true, reverse: true, autocomplete: false, fuzzy: true }),
    async search(searchRequest: GeocodingSearchRequest) {
      if (searchRequest.trigger === "autocomplete") {
        throw new GeocoderError(
          "PROVIDER_TRIGGER_UNSUPPORTED",
          "HERE autocomplete trigger is disabled by policy",
        );
      }
      const query = searchRequest.query.normalize("NFKC").trim().replace(/\s+/gu, " ");
      if (!query) return [];
      const parameters = new URLSearchParams({
        q: query,
        limit: String(Math.min(Math.max(searchRequest.limit ?? 5, 1), 10)),
      });
      parameters.set("lang", searchRequest.locale ?? options.language);
      const countries = [...(searchRequest.context?.countryCodes ?? [])]
        .map((code) => code.toUpperCase())
        .sort();
      if (countries.length > 0) parameters.append("in", `countryCode:${countries.join(",")}`);
      const viewbox = searchRequest.context?.viewbox;
      if (viewbox) parameters.append("in", `bbox:${viewbox.join(",")}`);
      const result = items(await request(viewbox ? endpoints.discover : endpoints.geocode, parameters))
        .map((item) => normalize(item, options.profile, countries));
      return result.sort((left, right) => right.providerScore - left.providerScore);
    },
    async reverse(point: Wgs84Point, locale?: string) {
      assertWgs84Point(point);
      const parameters = new URLSearchParams({
        at: `${point.latitude},${point.longitude}`,
        limit: "1",
      });
      if (locale) parameters.set("lang", locale);
      const item = items(await request(endpoints.reverse, parameters))[0];
      return item ? normalize(item, options.profile) : null;
    },
  };
}
