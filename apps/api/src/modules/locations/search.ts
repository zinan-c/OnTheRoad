import {
  createAmapGeocoder,
  createFixtureGeocoder,
  createHereGeocoder,
  createHybridGeocoder,
  GeocoderError,
  type Geocoder,
  type GeocodingFetch,
  type GeocodingContext,
} from "@on-the-road/providers/geocoding";

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
 * submit that signed token, never a raw HERE or fixture identifier.
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
  readonly provider: "here" | "amap" | "fixture";
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
}) {
  const { geocoder, logger } = options;
  const reportedMapProfile = options.mapProfile ?? geocoder.profile;
  async function searchForResolution(input: LocationSearchInput) {
    const trigger = input.trigger ?? "explicit";
    if (trigger !== "explicit") {
      throw new GeocoderError(
        "PROVIDER_TRIGGER_UNSUPPORTED",
        `${trigger} geocoding is disabled by provider policy`,
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
            : geocoder.provider === "hybrid"
              ? "© HERE / © 高德地图"
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
  } = {},
) {
  const profile = environment.MAP_PROFILE;
  if (profile === "fixture") {
    return createLocationSearchApi({
      geocoder: createFixtureGeocoder({ profile: "fixture-global" }),
      mapProfile: profile,
      ...(options.logger ? { logger: options.logger } : {}),
    });
  }
  if (profile === "international_primary") {
    return createLocationSearchApi({
      geocoder: createHereGeocoder({
        profile: "commercial-required",
        apiKey: environment.OTR_HERE_API_KEY ?? "",
        language: environment.MAP_LANGUAGE ?? "en",
        ...(options.fetch ? { fetch: options.fetch } : {}),
      }),
      mapProfile: profile,
      ...(options.logger ? { logger: options.logger } : {}),
    });
  }
  if (profile === "cn_primary") {
    return createLocationSearchApi({
      geocoder: createAmapGeocoder({
        profile: "cn-primary",
        apiKey: environment.AMAP_API_KEY ?? "",
        language: environment.MAP_LANGUAGE ?? "zh-CN",
        ...(options.fetch ? { fetch: options.fetch } : {}),
      }),
      mapProfile: profile,
      ...(options.logger ? { logger: options.logger } : {}),
    });
  }
  if (profile === "hybrid") {
    const fetchOption = options.fetch ? { fetch: options.fetch } : {};
    return createLocationSearchApi({
      geocoder: createHybridGeocoder({
        amap: createAmapGeocoder({
          profile: "cn-primary",
          apiKey: environment.AMAP_API_KEY ?? "",
          language: environment.MAP_LANGUAGE ?? "zh-CN",
          ...fetchOption,
        }),
        here: createHereGeocoder({
          profile: "commercial-required",
          apiKey: environment.OTR_HERE_API_KEY ?? "",
          language: environment.MAP_LANGUAGE ?? "en",
          ...fetchOption,
        }),
      }),
      mapProfile: profile,
      ...(options.logger ? { logger: options.logger } : {}),
    });
  }
  throw new GeocoderError(
    "PROVIDER_RESPONSE_INVALID",
    `Unknown MAP_PROFILE: ${profile ?? "(missing)"}`,
  );
}
