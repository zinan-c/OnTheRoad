import tripFixtureJson from "../../../packages/test-fixtures/src/trips/minimal-five-day.json" with { type: "json" };

export interface MockHere {
  geocodeEndpoint: string;
  discoverEndpoint: string;
  reverseGeocodeEndpoint: string;
  fixtureVersion: string;
  requests: URL[];
  fetchImplementation: typeof fetch;
  close(): Promise<void>;
}

const tripFixture = tripFixtureJson as {
  fixtureVersion: string;
  locations: Array<{ id: string; name: string; longitude: number; latitude: number }>;
};

export async function startMockHere(): Promise<MockHere> {
  const requests: URL[] = [];
  const fetchImplementation = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    const query = url.searchParams.get("q");
    if (query === "rate-limit") {
      return Response.json({ error: "rate limited" }, { status: 429, headers: { "retry-after": "7" } });
    }
    if (query === "server-error") {
      return Response.json({ error: "unavailable" }, { status: 503 });
    }
    if (query === "timeout") {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }
    if (url.pathname === "/v1/geocode" || url.pathname === "/v1/discover") {
      const matches = query === "Springfield"
        ? [
            { id: "here:fixture:springfield-il", title: "Springfield, Illinois, United States", position: { lat: 39.7989763, lng: -89.6443688 }, resultType: "locality", scoring: { queryScore: 0.8 }, address: { countryCode: "USA" } },
            { id: "here:fixture:springfield-ma", title: "Springfield, Massachusetts, United States", position: { lat: 42.1018764, lng: -72.5886727 }, resultType: "locality", scoring: { queryScore: 0.7 }, address: { countryCode: "USA" } }
          ]
        : tripFixture.locations
            .filter((location) => location.name.toLowerCase().includes((query ?? "").toLowerCase()))
            .map((location, index) => ({
              id: `here:fixture:${location.id}`,
              title: location.name,
              position: { lat: location.latitude, lng: location.longitude },
              resultType: "place",
              scoring: { queryScore: 1 - index / 100 },
              address: { label: location.name, countryCode: "CHN" }
            }));
      return Response.json({ items: matches });
    }
    if (url.pathname === "/v1/revgeocode") {
      const parts = (url.searchParams.get("at") ?? "").split(",");
      const latitude = Number(parts[0]);
      const longitude = Number(parts[1]);
      const nearest = tripFixture.locations.find(
        (location) => Math.abs(location.longitude - longitude) < 0.001 && Math.abs(location.latitude - latitude) < 0.001,
      );
      if (!nearest) return Response.json({ items: [] });
      return Response.json({ items: [{
        id: `here:fixture:${nearest.id}`,
        title: nearest.name,
        position: { lat: nearest.latitude, lng: nearest.longitude },
        resultType: "place",
        address: { label: nearest.name, countryCode: "CHN" }
      }] });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  }) as typeof fetch;

  return {
    geocodeEndpoint: "https://geocode.fixture.test/v1/geocode",
    discoverEndpoint: "https://geocode.fixture.test/v1/discover",
    reverseGeocodeEndpoint: "https://revgeocode.fixture.test/v1/revgeocode",
    fixtureVersion: tripFixture.fixtureVersion,
    requests,
    fetchImplementation,
    close: async () => undefined
  };
}
