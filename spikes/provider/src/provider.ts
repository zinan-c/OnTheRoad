import { toWgs84, type Coordinate, type Crs, type Wgs84Coordinate } from "./coordinates.js";

export type ProviderErrorCode =
  | "PROVIDER_CREDENTIALS_MISSING"
  | "PROVIDER_CREDENTIALS_INVALID"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_NO_RESULT"
  | "PROVIDER_RESPONSE_INVALID"
  | "PROVIDER_ATTRIBUTION_MISSING";

export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | undefined;
  readonly status: number | undefined;
  readonly provider = "here";

  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    details: { retryable?: boolean; retryAfterSeconds?: number; status?: number } = {},
  ) {
    super(`${code}: ${message}`);
    this.name = "ProviderError";
    this.retryable = details.retryable ?? false;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.status = details.status;
  }
}

export interface SearchContext {
  countryCodes?: string[];
  viewbox?: [number, number, number, number];
}

export interface SearchRequest {
  query: string;
  context?: SearchContext;
  limit?: number;
}

export interface Candidate {
  id: string;
  label: string;
  coordinate: Wgs84Coordinate;
  countryCode?: string;
  type?: string;
  importance?: number;
  attribution: string;
  selected: false;
  provider: "here";
  mapProfile: string;
}

export interface HereAdapterOptions {
  geocodeEndpoint: string;
  discoverEndpoint: string;
  reverseGeocodeEndpoint: string;
  profile: string;
  language: string;
  apiKey: string;
  timeoutMs?: number;
  responseCrs?: Crs;
  fetchImplementation?: typeof fetch;
}

interface RawHereItem {
  id?: string;
  title?: string;
  resultType?: string;
  position?: { lat?: number; lng?: number };
  address?: { label?: string; countryCode?: string };
  scoring?: { queryScore?: number };
}

interface RawHereResponse {
  items?: RawHereItem[];
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1_000)) : undefined;
}

function normalizeItem(raw: RawHereItem, options: HereAdapterOptions): Candidate {
  const longitude = Number(raw.position?.lng);
  const latitude = Number(raw.position?.lat);
  const label = raw.title ?? raw.address?.label;
  if (!raw.id || !label || !Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new ProviderError("PROVIDER_RESPONSE_INVALID", "candidate is missing label or coordinate");
  }
  let coordinate: Wgs84Coordinate;
  try {
    coordinate = toWgs84({ longitude, latitude }, options.responseCrs ?? "WGS84");
  } catch {
    throw new ProviderError("PROVIDER_RESPONSE_INVALID", "candidate coordinate is invalid");
  }
  return {
    id: raw.id,
    label,
    coordinate,
    ...(raw.address?.countryCode ? { countryCode: raw.address.countryCode.toLowerCase() } : {}),
    ...(raw.resultType ? { type: raw.resultType } : {}),
    ...(raw.scoring?.queryScore === undefined ? {} : { importance: raw.scoring.queryScore }),
    attribution: "© HERE",
    selected: false,
    provider: "here",
    mapProfile: options.profile
  };
}

function parseEndpoint(value: string, field: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new ProviderError("PROVIDER_RESPONSE_INVALID", `${field} URL is invalid`);
  }
  if (endpoint.protocol !== "https:" && endpoint.hostname !== "geocode.fixture.test" && endpoint.hostname !== "revgeocode.fixture.test") {
    throw new ProviderError("PROVIDER_RESPONSE_INVALID", `${field} must use HTTPS`);
  }
  return endpoint.toString();
}

function responseItems(payload: unknown): RawHereItem[] {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new ProviderError("PROVIDER_RESPONSE_INVALID", "HERE response must be an object");
  }
  const items = (payload as RawHereResponse).items;
  if (!Array.isArray(items)) {
    throw new ProviderError("PROVIDER_RESPONSE_INVALID", "HERE response items must be an array");
  }
  return items;
}

export class HereAdapter {
  readonly #options: HereAdapterOptions;
  readonly #fetch: typeof fetch;

  constructor(options: HereAdapterOptions) {
    if (!options.apiKey.trim()) {
      throw new ProviderError("PROVIDER_CREDENTIALS_MISSING", "HERE API key is required");
    }
    this.#options = {
      ...options,
      geocodeEndpoint: parseEndpoint(options.geocodeEndpoint, "geocodeEndpoint"),
      discoverEndpoint: parseEndpoint(options.discoverEndpoint, "discoverEndpoint"),
      reverseGeocodeEndpoint: parseEndpoint(options.reverseGeocodeEndpoint, "reverseGeocodeEndpoint")
    };
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async #request(endpoint: string, parameters: URLSearchParams): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#options.timeoutMs ?? 2_000);
    const url = new URL(endpoint);
    parameters.set("apiKey", this.#options.apiKey);
    parameters.set("lang", this.#options.language);
    url.search = parameters.toString();
    try {
      const response = await this.#fetch(url, {
        headers: { "accept": "application/json" },
        signal: controller.signal
      });
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError("PROVIDER_CREDENTIALS_INVALID", "HERE rejected the API key", {
          status: response.status
        });
      }
      if (response.status === 429) {
        const retryAfter = retryAfterSeconds(response);
        throw new ProviderError("PROVIDER_RATE_LIMITED", "provider rate limit", {
          retryable: true,
          ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
          status: 429
        });
      }
      if (!response.ok) {
        throw new ProviderError("PROVIDER_UNAVAILABLE", "provider request failed", {
          retryable: response.status >= 500,
          status: response.status
        });
      }
      return await response.json();
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (controller.signal.aborted) {
        throw new ProviderError("PROVIDER_TIMEOUT", "provider request timed out", { retryable: true });
      }
      throw new ProviderError("PROVIDER_UNAVAILABLE", "provider transport failed", { retryable: true });
    } finally {
      clearTimeout(timeout);
    }
  }

  async search(request: SearchRequest): Promise<Candidate[]> {
    const query = request.query.trim();
    if (!query) return [];
    const parameters = new URLSearchParams({
      q: query,
      limit: String(Math.min(Math.max(request.limit ?? 5, 1), 10))
    });
    const hasBoundingBox = request.context?.viewbox !== undefined;
    if (request.context?.countryCodes?.length) {
      parameters.append(
        "in",
        `countryCode:${[...request.context.countryCodes].map((code) => code.toUpperCase()).sort().join(",")}`,
      );
    }
    if (request.context?.viewbox) parameters.append("in", `bbox:${request.context.viewbox.join(",")}`);
    const payload = await this.#request(
      hasBoundingBox ? this.#options.discoverEndpoint : this.#options.geocodeEndpoint,
      parameters,
    );
    return responseItems(payload).map((item) => normalizeItem(item, this.#options));
  }

  async reverse(coordinate: Coordinate): Promise<Candidate> {
    const wgs84 = toWgs84(coordinate, coordinate.crs);
    const payload = await this.#request(this.#options.reverseGeocodeEndpoint, new URLSearchParams({
      at: `${wgs84.latitude},${wgs84.longitude}`,
      limit: "1"
    }));
    const item = responseItems(payload)[0];
    if (!item) {
      throw new ProviderError("PROVIDER_NO_RESULT", "HERE reverse geocoder returned no result");
    }
    return normalizeItem(item, this.#options);
  }
}

export interface CacheKeyInput {
  provider: string;
  profile: string;
  language: string;
  query: string;
  context?: SearchContext;
}

export function providerCacheKey(input: CacheKeyInput): string {
  const canonical = JSON.stringify({
    provider: input.provider.toLowerCase(),
    profile: input.profile,
    language: input.language.toLowerCase(),
    query: input.query.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase(),
    context: input.context ? {
      countryCodes: input.context.countryCodes?.map((code) => code.toLowerCase()).sort(),
      viewbox: input.context.viewbox
    } : null
  });
  const encoded = [...new TextEncoder().encode(canonical)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `provider:v1:${encoded}`;
}
