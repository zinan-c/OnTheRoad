import { IdentityService } from "../../src/modules/identity/service.mjs";
import { createApiApplication } from "../../src/app.js";
import type { ApiRuntime } from "../../src/runtime.js";
import { afterEach, describe, expect, test } from "vitest";

let app: Awaited<ReturnType<typeof createApiApplication>> | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function runtime(readiness: Record<string, boolean>): ApiRuntime {
  const identity = new IdentityService({
    environment: "development",
    developmentIdentityEnabled: true,
    appOrigin: "http://localhost:3000",
    signingKeys: {
      active: {
        id: "test-v1",
        secret: "composition-root-test-secret-at-least-32-characters",
      },
    },
  });
  const trips = new Map<string, Record<string, unknown>>();
  const items = new Map<string, Record<string, unknown>>();
  const locations = new Map<string, Record<string, unknown>>();
  return {
    appOrigin: "http://localhost:3000",
    environment: "development",
    identity,
    trips: {
      async createTrip(ownerId: string, input: Record<string, unknown>) {
        const trip = {
          ...input,
          id: "106144e2-4d65-4bd0-a67d-43edbc88ac8d",
          ownerId,
          version: 1,
        };
        trips.set(String(trip.id), trip);
        return trip;
      },
      async getTrip(_ownerId: string, tripId: string) {
        return trips.get(tripId);
      },
      async listTrips() {
        return { items: [...trips.values()], nextCursor: null };
      },
    },
    itinerary: {
      async create(_ownerId: string, tripId: string, input: Record<string, unknown>) {
        const item = {
          ...input,
          id: "206144e2-4d65-4bd0-a67d-43edbc88ac8d",
          tripId,
          version: 1,
        };
        items.set(String(item.id), item);
        return item;
      },
      async listDay() {
        return [...items.values()];
      },
    },
    locations: {
      async create(ownerId: string, tripId: string, input: Record<string, unknown>) {
        const location = {
          ...input,
          id: "306144e2-4d65-4bd0-a67d-43edbc88ac8d",
          ownerId,
          tripId,
          version: 1,
          status: "unresolved",
        };
        locations.set(String(location.id), location);
        return location;
      },
      async manuallyAdjust(
        _ownerId: string,
        locationId: string,
        expectedVersion: number,
        point: unknown,
      ) {
        const current = locations.get(locationId) ?? {};
        const location = {
          ...current,
          point,
          status: "resolved",
          manuallyAdjusted: true,
          version: expectedVersion + 1,
        };
        locations.set(locationId, location);
        return location;
      },
    },
    locationCoordinates: {
      async get(_ownerId: string, locationId: string) {
        return { location: locations.get(locationId) };
      },
      async manual(_ownerId: string, locationId: string, body: { point: unknown }, headers: { ifMatch?: string }) {
        const current = locations.get(locationId) ?? {};
        const expectedVersion = Number(headers.ifMatch?.replaceAll('"', ""));
        const location = {
          ...current,
          point: body.point,
          status: "resolved",
          manuallyAdjusted: true,
          version: expectedVersion + 1,
        };
        locations.set(locationId, location);
        return { location, etag: `"${location.version}"` };
      },
    },
    locationSearch: {
      capabilities: () => ({
        provider: "fixture",
        mapProfile: "fixture",
        search: true,
        reverse: true,
        autocomplete: false,
        fuzzy: true,
      }),
      async search() {
        return { provider: "fixture", mapProfile: "fixture", candidates: [] };
      },
    },
    expenses: {},
    attachments: {},
    referenceData: () => ({
      currencies: [],
      costCategories: [],
      transportModes: [],
      currencyAliases: {},
    }),
    checkReadiness: async () => readiness,
    close: async () => {},
  } as unknown as ApiRuntime;
}

describe("REVIEW-P0-01 API composition root", () => {
  test("advertises the composed fixture directions and static map capabilities", async () => {
    app = await createApiApplication(runtime({}));
    const server = app.getHttpAdapter().getInstance();
    const response = await server.inject({ method: "GET", url: "/api/v1/system/capabilities" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ directions: true, staticMaps: true });
  });

  test("liveness is independent while readiness fails closed", async () => {
    app = await createApiApplication(runtime({
      database: true,
      schema: false,
      redis: true,
      storage: true,
      clamav: true,
      mapProvider: true,
    }));
    const server = app.getHttpAdapter().getInstance();

    await expect(server.inject({ method: "GET", url: "/health/live" }))
      .resolves.toMatchObject({ statusCode: 200 });
    const ready = await server.inject({ method: "GET", url: "/health/ready" });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toMatchObject({
      status: "not_ready",
      dependencies: { schema: false },
    });
  });

  test("assembles login, Trip, Item, Location confirmation and reload routes", async () => {
    app = await createApiApplication(runtime({
      database: true,
      schema: true,
      redis: true,
      storage: true,
      clamav: true,
      mapProvider: true,
    }));
    const server = app.getHttpAdapter().getInstance();
    const login = await server.inject({
      method: "POST",
      url: "/api/v1/identity/development-session",
      headers: { origin: "http://localhost:3000" },
      payload: { subject: "smoke-owner" },
    });
    expect(login.statusCode).toBe(201);
    const sessionCookie = login.headers["set-cookie"]?.split(";")[0];
    expect(sessionCookie).toContain("otr_dev_session=");

    const trip = await server.inject({
      method: "POST",
      url: "/api/v1/trips",
      headers: {
        cookie: sessionCookie,
        "idempotency-key": "smoke-trip-1",
      },
      payload: {
        name: "上海与舟山五日",
        startDate: "2026-08-01",
        endDate: "2026-08-05",
      },
    });
    expect(trip.statusCode).toBe(201);
    const tripId = trip.json().id;

    const item = await server.inject({
      method: "POST",
      url: `/api/v1/trips/${tripId}/days/406144e2-4d65-4bd0-a67d-43edbc88ac8d/itinerary-items`,
      headers: { cookie: sessionCookie },
      payload: { itemType: "attraction", timeKind: "period", target: "漫步外滩" },
    });
    expect(item.statusCode).toBe(201);

    const createdLocation = await server.inject({
      method: "POST",
      url: `/api/v1/trips/${tripId}/locations`,
      headers: { cookie: sessionCookie },
      payload: { inputText: "上海外滩" },
    });
    const locationId = createdLocation.json().id;
    const confirmed = await server.inject({
      method: "PATCH",
      url: `/api/v1/trips/${tripId}/locations/${locationId}/coordinates`,
      headers: { cookie: sessionCookie, "if-match": "1" },
      payload: { longitude: 121.49002, latitude: 31.24001 },
    });
    expect(confirmed.json()).toMatchObject({
      status: "resolved",
      manuallyAdjusted: true,
    });

    const reloaded = await server.inject({
      method: "GET",
      url: `/api/v1/trips/${tripId}`,
      headers: { cookie: sessionCookie },
    });
    expect(reloaded.statusCode).toBe(200);
    expect(reloaded.json().name).toBe("上海与舟山五日");
  });

  test("allows credentialed browser logout through the CORS preflight", async () => {
    app = await createApiApplication(runtime({
      database: true,
      schema: true,
      redis: true,
      storage: true,
      clamav: true,
      mapProvider: true,
    }));
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "OPTIONS",
      url: "/api/v1/identity/session",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "DELETE",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("DELETE");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });
});
