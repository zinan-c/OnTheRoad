import {
  createFixtureGeocoder,
  createHereGeocoder,
  GeocoderError,
  type Geocoder,
  type GeocodingContext,
} from "../../../../../packages/providers/src/geocoding/index.js";

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
  readonly point: {
    readonly longitude: number;
    readonly latitude: number;
    readonly crs: "WGS84";
  };
  readonly confidence: number;
  readonly attribution: string;
  readonly selected: false;
  readonly provider: "here" | "fixture";
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
  return {
    capabilities() {
      return {
        provider: geocoder.provider,
        mapProfile: reportedMapProfile,
        ...geocoder.capabilities(),
      };
    },
    async search(input: LocationSearchInput) {
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
          ?? (geocoder.provider === "here" ? "© HERE" : "On The Road fixture"),
        candidates: candidates.map((candidate): LocationSearchCandidateView => ({
          label: candidate.label,
          formattedAddress: candidate.formattedAddress ?? candidate.label,
          countryCode: candidate.countryCode ?? null,
          city: candidate.city ?? null,
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
    readonly fetch?: Parameters<typeof createHereGeocoder>[0]["fetch"];
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
  if (profile === "cn_primary" || profile === "hybrid") {
    throw new GeocoderError(
      "PROVIDER_PROFILE_UNSUPPORTED",
      `${profile} geocoding is not implemented`,
    );
  }
  throw new GeocoderError(
    "PROVIDER_RESPONSE_INVALID",
    `Unknown MAP_PROFILE: ${profile ?? "(missing)"}`,
  );
}
