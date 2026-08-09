import fixtureJson from "../../../test-fixtures/src/trips/minimal-five-day.json" with { type: "json" };

import { assertWgs84Point } from "../contracts/validation.js";
import { GeocoderError } from "./errors.js";
import type { Geocoder, NormalizedCandidate } from "./types.js";

const locations = (fixtureJson as {
  locations: Array<{ id: string; name: string; longitude: number; latitude: number }>;
}).locations;

const fixtureContext: Record<string, { formattedAddress: string; city: string; district: string }> = {
  "loc-people-square-shanghai": { formattedAddress: "上海市黄浦区人民大道人民广场", city: "上海", district: "黄浦区" },
  "loc-people-square-chongqing": { formattedAddress: "重庆市渝中区人民路人民广场", city: "重庆", district: "渝中区" },
};

export function createFixtureGeocoder(
  options: { readonly profile: "fixture-cn" | "fixture-global" },
): Geocoder {
  const candidate = (location: typeof locations[number]): NormalizedCandidate => ({
    id: `fixture:${location.id}`,
    label: location.name,
    point: { longitude: location.longitude, latitude: location.latitude, crs: "WGS84" },
    countryCode: "CN",
    ...(fixtureContext[location.id] ?? {}),
    providerScore: 1,
    attribution: "On The Road fixture",
    selected: false,
    provider: "fixture",
    mapProfile: options.profile,
  });
  return {
    provider: "fixture",
    profile: options.profile,
    capabilities: () => ({ search: true, reverse: true, autocomplete: false, fuzzy: true }),
    async search(request) {
      if (request.trigger === "autocomplete" || request.trigger === "batch") {
        throw new GeocoderError(
          "PROVIDER_TRIGGER_UNSUPPORTED",
          `Fixture ${request.trigger} trigger is disabled by policy`,
        );
      }
      const query = request.query.normalize("NFKC").trim().toLocaleLowerCase("und");
      return locations
        .filter((location) => location.name.toLocaleLowerCase("und").includes(query))
        .slice(0, Math.min(Math.max(request.limit ?? 5, 1), 20))
        .map(candidate);
    },
    async reverse(point) {
      assertWgs84Point(point);
      const location = locations.find((entry) =>
        Math.abs(entry.longitude - point.longitude) < 0.000_001
        && Math.abs(entry.latitude - point.latitude) < 0.000_001);
      return location ? candidate(location) : null;
    },
  };
}
