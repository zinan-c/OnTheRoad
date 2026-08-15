import { GeocoderError } from "./errors.js";
import type { GeocodingStateStore, TokenBucketPolicy } from "./store.js";
import type {
  Geocoder,
  GeocodingSearchRequest,
  NormalizedCandidate,
} from "./types.js";
import type { Wgs84Point } from "../contracts/dto.js";

export interface GeocodingPolicyOptions {
  readonly store: GeocodingStateStore;
  readonly cacheTtlSeconds: number;
  readonly bucket: TokenBucketPolicy;
  /** Shared scope used when a public provider has one application-wide quota. */
  readonly bucketKey?: string;
  readonly maxRetries?: number;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

function hash(value: string): string {
  let result = 2_166_136_261;
  for (const byte of new TextEncoder().encode(value)) {
    result ^= byte;
    result = Math.imul(result, 16_777_619);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

function cacheKey(provider: Geocoder, request: GeocodingSearchRequest): string {
  const canonical = JSON.stringify({
    provider: provider.provider,
    profile: provider.profile,
    locale: (request.locale ?? "").toLowerCase(),
    query: request.query.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase(),
    countryCodes: request.context?.countryCodes?.map((code) => code.toLowerCase()).sort() ?? [],
    viewbox: request.context?.viewbox ?? null,
  });
  return `geocoding:v2:${hash(canonical)}`;
}

export class PolicyGeocoder implements Geocoder {
  readonly provider;
  readonly profile;
  readonly #now;
  readonly #sleep;

  constructor(
    readonly upstream: Geocoder,
    readonly options: GeocodingPolicyOptions,
  ) {
    this.provider = upstream.provider;
    this.profile = upstream.profile;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  capabilities() {
    return this.upstream.capabilities();
  }

  async #takeToken(): Promise<void> {
    const decision = await this.options.store.takeToken(
      `geocoding:bucket:${this.options.bucketKey ?? `${this.provider}:${this.profile}`}`,
      this.options.bucket,
      this.#now(),
    );
    if (!decision.allowed) {
      throw new GeocoderError("PROVIDER_RATE_LIMITED", "Client token bucket exhausted", {
        retryable: true,
        retryAfterSeconds: Math.ceil(decision.retryAfterMs / 1_000),
        source: "client",
        provider: this.provider,
      });
    }
  }

  async #execute<T>(operation: () => Promise<T>): Promise<T> {
    const maxAttempts = (this.options.maxRetries ?? 2) + 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await this.#takeToken();
      try {
        return await operation();
      } catch (error) {
        if (
          !(error instanceof GeocoderError)
          || !error.retryable
          || error.code === "PROVIDER_RATE_LIMITED"
          || attempt + 1 >= maxAttempts
        ) throw error;
        await this.#sleep(250 * 2 ** attempt);
      }
    }
    throw new GeocoderError("PROVIDER_UNAVAILABLE", "Geocoding retry policy exhausted");
  }

  async search(request: GeocodingSearchRequest): Promise<NormalizedCandidate[]> {
    const key = cacheKey(this.upstream, request);
    const cached = await this.options.store.get(key, this.#now());
    if (cached) return JSON.parse(cached) as NormalizedCandidate[];
    const result = await this.#execute(() => this.upstream.search(request));
    await this.options.store.set(
      key,
      JSON.stringify(result),
      this.options.cacheTtlSeconds,
      this.#now(),
    );
    return result;
  }

  async reverse(point: Wgs84Point, locale?: string) {
    const key = `geocoding:v1:reverse:${hash(JSON.stringify({
      provider: this.provider,
      profile: this.profile,
      locale: locale?.toLowerCase() ?? "",
      longitude: point.longitude,
      latitude: point.latitude,
      crs: point.crs,
    }))}`;
    const cached = await this.options.store.get(key, this.#now());
    if (cached) return JSON.parse(cached) as NormalizedCandidate | null;
    const result = await this.#execute(() => this.upstream.reverse(point, locale));
    await this.options.store.set(
      key,
      JSON.stringify(result),
      this.options.cacheTtlSeconds,
      this.#now(),
    );
    return result;
  }
}
