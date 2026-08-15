import {
  createAmapGeocoder,
  createFixtureGeocoder,
  createHybridGeocoder,
  createNominatimGeocoder,
  GeocoderError,
  PolicyGeocoder,
  type Geocoder,
  type GeocodingFetch,
  type GeocodingContext,
  type GeocodingPolicyOptions,
} from "@on-the-road/providers/geocoding";
import type { Wgs84Point } from "@on-the-road/providers";

export interface LocationSearchLogger {
  info(event: string, fields: Readonly<Record<string, unknown>>): void;
}

export interface LocationSearchInput {
  readonly query: string;
  readonly locale?: string;
  readonly limit?: number;
  readonly context?: GeocodingContext;
  readonly trigger?: "explicit" | "autocomplete" | "batch";
}

export type ExternalMapProfile =
  | "fixture"
  | "cn_primary"
  | "international_primary"
  | "hybrid";

/**
 * Deliberately excludes the upstream provider place ID. Provider candidates are
 * internal inputs to C03's owner/trip/location-bound candidate signer; a UI must
 * submit that signed token, never a raw upstream or fixture identifier.
 */
export interface LocationSearchCandidateView {
  readonly label: string;
  readonly formattedAddress: string;
  readonly countryCode: string | null;
  readonly city: string | null;
  readonly district: string | null;
  readonly point: {
    readonly longitude: number;
    readonly latitude: number;
    readonly crs: "WGS84";
  };
  readonly confidence: number;
  readonly attribution: string;
  readonly selected: false;
  readonly provider: "here" | "amap" | "nominatim" | "fixture";
  readonly mapProfile: ExternalMapProfile | string;
}

function queryFingerprint(query: string): string {
  let hash = 2_166_136_261;
  for (const byte of new TextEncoder().encode(query.normalize("NFKC").trim())) {
    hash ^= byte;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createLocationSearchApi(options: {
  readonly geocoder: Geocoder;
  readonly mapProfile?: ExternalMapProfile;
  readonly logger?: LocationSearchLogger;
  readonly policy?: GeocodingPolicyOptions;
}) {
  const geocoder = options.policy
    ? new PolicyGeocoder(options.geocoder, options.policy)
    : options.geocoder;
  const { logger } = options;
  const reportedMapProfile = options.mapProfile ?? geocoder.profile;
  async function searchForResolution(input: LocationSearchInput) {
    const trigger = input.trigger ?? "explicit";
    if (trigger !== "explicit") {
      throw new GeocoderError(
        "PROVIDER_TRIGGER_UNSUPPORTED",
        `${trigger} geocoding is disabled by provider policy`,
        { provider: geocoder.provider, source: "client" },
      );
    }
    logger?.info("location.search.started", {
      provider: geocoder.provider,
      mapProfile: reportedMapProfile,
      queryLength: input.query.length,
      queryFingerprint: queryFingerprint(input.query),
    });
    const candidates = await geocoder.search({ ...input, trigger });
    return {
      provider: geocoder.provider,
      mapProfile: reportedMapProfile,
      attribution: candidates[0]?.attribution
        ?? (geocoder.provider === "amap"
          ? "© 高德地图"
          : geocoder.provider === "here"
            ? "© HERE"
            : geocoder.provider === "nominatim"
              ? "© OpenStreetMap contributors"
            : geocoder.provider === "hybrid"
              ? "© OpenStreetMap contributors / © 高德地图"
              : "On The Road fixture"),
      candidates,
    };
  }
  return {
    capabilities() {
      return {
        provider: geocoder.provider,
        mapProfile: reportedMapProfile,
        ...geocoder.capabilities(),
      };
    },
    searchForResolution,
    reverse(point: Wgs84Point, locale?: string) {
      return geocoder.reverse(point, locale);
    },
    async search(input: LocationSearchInput) {
      const result = await searchForResolution(input);
      const { candidates } = result;
      return {
        provider: result.provider,
        mapProfile: result.mapProfile,
        attribution: result.attribution,
        candidates: candidates.map((candidate): LocationSearchCandidateView => ({
          label: candidate.label,
          formattedAddress: candidate.formattedAddress ?? candidate.label,
          countryCode: candidate.countryCode ?? null,
          city: candidate.city ?? null,
          district: candidate.district ?? null,
          point: candidate.point,
          confidence: candidate.providerScore,
          attribution: candidate.attribution,
          selected: false as const,
          provider: candidate.provider,
          mapProfile: reportedMapProfile,
        })),
      };
    },
  };
}

export function createConfiguredLocationSearchApi(
  environment: Readonly<Record<string, string | undefined>>,
  options: {
    readonly logger?: LocationSearchLogger;
    readonly fetch?: GeocodingFetch;
    readonly policy?: GeocodingPolicyOptions;
  } = {},
) {
  const profile = environment.MAP_PROFILE;
  const applyPolicy = (geocoder: Geocoder): Geocoder => options.policy
    ? new PolicyGeocoder(geocoder, options.policy)
    : geocoder;
  const nominatimOptions = {
    profile: "public-online" as const,
    baseUrl: environment.OTR_NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org",
    userAgent: environment.OTR_NOMINATIM_USER_AGENT ?? "",
    contact: environment.OTR_NOMINATIM_CONTACT ?? "",
    language: environment.MAP_LANGUAGE ?? "en",
    timeoutMs: Number(environment.OTR_NOMINATIM_TIMEOUT_MS ?? "5000"),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  };
  if (profile === "fixture") {
    return createLocationSearchApi({
      geocoder: createFixtureGeocoder({ profile: "fixture-global" }),
      mapProfile: profile,
      ...(options.logger ? { logger: options.logger } : {}),
    });
  }
  if (profile === "international_primary") {
    return createLocationSearchApi({
      geocoder: applyPolicy(createNominatimGeocoder(nominatimOptions)),
      mapProfile: profile,
      ...(options.logger ? { logger: options.logger } : {}),
    });
  }
  if (profile === "cn_primary") {
    return createLocationSearchApi({
      geocoder: applyPolicy(createAmapGeocoder({
        profile: "cn-primary",
        apiKey: environment.AMAP_API_KEY ?? "",
        language: environment.MAP_LANGUAGE ?? "zh-CN",
        ...(options.fetch ? { fetch: options.fetch } : {}),
      })),
      mapProfile: profile,
      ...(options.logger ? { logger: options.logger } : {}),
    });
  }
  if (profile === "hybrid") {
    const fetchOption = options.fetch ? { fetch: options.fetch } : {};
    return createLocationSearchApi({
      geocoder: applyPolicy(createHybridGeocoder({
        amap: createAmapGeocoder({
          profile: "cn-primary",
          apiKey: environment.AMAP_API_KEY ?? "",
          language: environment.MAP_LANGUAGE ?? "zh-CN",
          ...fetchOption,
        }),
        nominatim: createNominatimGeocoder({ ...nominatimOptions, ...fetchOption }),
      })),
      mapProfile: profile,
      ...(options.logger ? { logger: options.logger } : {}),
    });
  }
  throw new GeocoderError(
    "PROVIDER_RESPONSE_INVALID",
    `Unknown MAP_PROFILE: ${profile ?? "(missing)"}`,
  );
}
