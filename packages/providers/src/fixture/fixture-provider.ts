import fixtureJson from "../../../test-fixtures/src/trips/minimal-five-day.json" with { type: "json" };

import type {
  GeocodeQuery,
  MapClientConfig,
  MapContext,
  PlaceCandidate,
  ProviderAttribution,
  RouteRequest,
  RouteResult,
  StaticMapAsset,
  StaticMapRequest,
  Wgs84Point,
} from "../contracts/dto.js";
import {
  unsupportedCapability,
  validateProviderAttribution,
  ProviderError,
} from "../contracts/errors.js";
import type {
  ProviderCapability,
  ProviderCapabilityMatrix,
  ProviderSuite,
} from "../contracts/providers.js";
import { assertWgs84Point } from "../contracts/validation.js";

const ATTRIBUTION = "On The Road fixture";
const MAX_STATIC_MAP_EDGE = 2_048;

interface FixtureLocation {
  readonly id: string;
  readonly name: string;
  readonly longitude: number;
  readonly latitude: number;
}

interface TripFixture {
  readonly locations: readonly FixtureLocation[];
}

const tripFixture = fixtureJson as TripFixture;

export interface FixtureProviderOptions {
  readonly capabilities?: Partial<Record<ProviderCapability, boolean>>;
}

function capabilityMatrix(options: FixtureProviderOptions): ProviderCapabilityMatrix {
  const enabled = (capability: ProviderCapability) => options.capabilities?.[capability] ?? true;
  return Object.freeze({
    map: enabled("map"),
    geocoding: enabled("geocoding"),
    reverseGeocoding: enabled("reverseGeocoding"),
    directions: enabled("directions"),
    staticMap: enabled("staticMap"),
    autocomplete: false,
    fuzzy: true,
  });
}

function requireCapability(matrix: ProviderCapabilityMatrix, capability: ProviderCapability): void {
  if (!matrix[capability]) throw unsupportedCapability(capability);
}

function point(location: FixtureLocation): Wgs84Point {
  const result: Wgs84Point = {
    longitude: location.longitude,
    latitude: location.latitude,
    crs: "WGS84",
  };
  assertWgs84Point(result);
  return result;
}

function candidate(location: FixtureLocation, score = 1): PlaceCandidate {
  return {
    id: `fixture:${location.id}`,
    label: location.name,
    point: point(location),
    countryCode: "CN",
    providerScore: score,
    attribution: ATTRIBUTION,
  };
}

function normalizeQuery(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("und");
}

function assertStaticMapRequest(request: StaticMapRequest): void {
  if (
    !Number.isInteger(request.width)
    || !Number.isInteger(request.height)
    || request.width < 1
    || request.height < 1
    || request.width > MAX_STATIC_MAP_EDGE
    || request.height > MAX_STATIC_MAP_EDGE
  ) {
    throw new ProviderError(
      "PROVIDER_REQUEST_INVALID",
      `Static map dimensions must be integers between 1 and ${MAX_STATIC_MAP_EDGE}`,
      false,
    );
  }
  request.points.forEach(assertWgs84Point);
}

function renderFixtureSvg(request: StaticMapRequest): string {
  const circles = request.points.map((_, index) => {
    const denominator = Math.max(1, request.points.length - 1);
    const x = 20 + ((request.width - 40) * index) / denominator;
    const y = request.height / 2;
    return `<circle cx="${x}" cy="${y}" r="6" fill="#155eef"/>`;
  }).join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${request.width}" height="${request.height}" viewBox="0 0 ${request.width} ${request.height}">`,
    '<rect width="100%" height="100%" fill="#f4f6f8"/>',
    `<path d="M20 ${request.height / 2} H${request.width - 20}" stroke="#667085" stroke-width="3"/>`,
    circles,
    `<text x="12" y="${request.height - 12}" font-size="12">${ATTRIBUTION}</text>`,
    "</svg>",
  ].join("");
}

export function createFixtureProvider(options: FixtureProviderOptions = {}): ProviderSuite {
  const matrix = capabilityMatrix(options);
  const attribution = validateProviderAttribution(ATTRIBUTION);

  return {
    capabilityMatrix: matrix,
    map: {
      async getClientConfig(context: MapContext): Promise<MapClientConfig> {
        requireCapability(matrix, "map");
        return {
          profile: context.profile,
          style: "neutral-grid",
          attribution,
        };
      },
      getAttribution(): ProviderAttribution {
        requireCapability(matrix, "map");
        return { text: attribution };
      },
    },
    geocoding: {
      capabilities() {
        return { autocomplete: matrix.autocomplete, fuzzy: matrix.fuzzy };
      },
      async search(query: GeocodeQuery): Promise<PlaceCandidate[]> {
        requireCapability(matrix, "geocoding");
        const normalized = normalizeQuery(query.query);
        if (!normalized) return [];
        const limit = Math.min(Math.max(query.limit ?? 5, 1), 20);
        return tripFixture.locations
          .filter((location) => normalizeQuery(location.name).includes(normalized))
          .slice(0, limit)
          .map((location, index) => candidate(location, 1 - index / 100));
      },
    },
    reverseGeocoding: {
      async reverse(searchPoint: Wgs84Point): Promise<PlaceCandidate | null> {
        requireCapability(matrix, "reverseGeocoding");
        assertWgs84Point(searchPoint);
        const match = tripFixture.locations.find((location) => (
          Math.abs(location.longitude - searchPoint.longitude) < 0.000_001
          && Math.abs(location.latitude - searchPoint.latitude) < 0.000_001
        ));
        return match ? candidate(match) : null;
      },
    },
    directions: {
      async route(request: RouteRequest): Promise<RouteResult> {
        requireCapability(matrix, "directions");
        assertWgs84Point(request.from);
        assertWgs84Point(request.to);
        return {
          kind: "approximate",
          mode: request.mode,
          geometry: {
            type: "LineString",
            coordinates: [request.from, request.to],
          },
          attribution,
        };
      },
    },
    staticMap: {
      async render(request: StaticMapRequest): Promise<StaticMapAsset> {
        requireCapability(matrix, "staticMap");
        assertStaticMapRequest(request);
        return {
          mediaType: "image/svg+xml",
          content: renderFixtureSvg(request),
          width: request.width,
          height: request.height,
          attribution,
        };
      },
    },
  };
}
