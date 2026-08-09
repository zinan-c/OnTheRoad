import { createHash } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";

import { createApiApplication } from "../../src/app.js";
import { IdentityService } from "../../src/modules/identity/service.mjs";
import type { ApiRuntime } from "../../src/runtime.js";

let app: Awaited<ReturnType<typeof createApiApplication>> | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

test("E2E-014 exposes explicit signed candidate confirmation without trusting provider payload", async () => {
  const ownerId = createHash("sha256").update("https://dev-identity.local/\u0000location-owner").digest("base64url");
  const base = { id: "location-1", tripId: "trip-1", ownerId, inputText: "人民广场", name: "人民广场", status: "unresolved", version: 1 };
  const beginResolving = vi.fn(async () => ({ location: { ...base, status: "resolving", version: 2 }, job: { id: "job-1" } }));
  const applyResult = vi.fn(async (_owner: string, _job: string, result: { status: string; candidates: Array<{ providerPlaceId: string }> }) => ({
    location: { ...base, status: "ambiguous", version: 3 },
    job: { id: "job-1", status: "ambiguous", candidates: result.candidates.map((candidate) => `signed:${candidate.providerPlaceId}`) },
  }));
  const selectCandidate = vi.fn(async () => ({ ...base, status: "resolved", provider: "fixture", version: 4 }));
  const identity = new IdentityService({
    environment: "development", developmentIdentityEnabled: true, appOrigin: "http://localhost:3000",
    signingKeys: { active: { id: "location-route-v1", secret: "location-route-secret-at-least-32-characters" } },
  });
  app = await createApiApplication({
    appOrigin: "http://localhost:3000", environment: "development", identity,
    trips: { getTrip: async () => ({ id: "trip-1", ownerId, mapProfile: "cn_primary" }) },
    locations: { get: async () => base, beginResolving, applyResult, selectCandidate },
    locationSearch: {
      capabilities: () => ({ provider: "fixture", mapProfile: "fixture", search: true, reverse: true, autocomplete: false, fuzzy: true }),
      searchForResolution: async () => ({
        provider: "fixture", mapProfile: "fixture", attribution: "On The Road fixture",
        candidates: [
          { id: "fixture:shanghai", label: "人民广场", formattedAddress: "上海市黄浦区人民大道人民广场", city: "上海", district: "黄浦区", countryCode: "CN", point: { longitude: 121.4752, latitude: 31.2304, crs: "WGS84" }, attribution: "On The Road fixture", provider: "fixture" },
          { id: "fixture:chongqing", label: "人民广场", formattedAddress: "重庆市渝中区人民路人民广场", city: "重庆", district: "渝中区", countryCode: "CN", point: { longitude: 106.5528, latitude: 29.5637, crs: "WGS84" }, attribution: "On The Road fixture", provider: "fixture" },
        ],
      }),
    },
    referenceData: () => ({}), checkReadiness: async () => ({ test: true }), close: async () => {},
  } as unknown as ApiRuntime);
  const server = app.getHttpAdapter().getInstance();
  const login = await server.inject({ method: "POST", url: "/api/v1/identity/development-session", headers: { origin: "http://localhost:3000" }, payload: { subject: "location-owner" } });
  const cookie = login.headers["set-cookie"]?.split(";")[0];
  const search = await server.inject({
    method: "POST", url: "/api/v1/trips/trip-1/locations/location-1/search",
    headers: { cookie, "if-match": "1" }, payload: { query: "人民广场" },
  });
  expect(search.statusCode).toBe(200);
  expect(search.json()).toMatchObject({ mapProfile: "cn_primary", candidates: [
    { city: "上海", district: "黄浦区", selected: false, candidateToken: "signed:fixture:shanghai" },
    { city: "重庆", district: "渝中区", selected: false, candidateToken: "signed:fixture:chongqing" },
  ] });
  expect(search.json().candidates[0]).not.toHaveProperty("providerPlaceId");
  expect(beginResolving).toHaveBeenCalledWith(ownerId, "location-1", 1, expect.objectContaining({ context: { mapProfile: "cn_primary", trigger: "explicit" } }));

  const confirmed = await server.inject({
    method: "POST", url: "/api/v1/trips/trip-1/locations/location-1/candidate",
    headers: { cookie, "if-match": "3" }, payload: { jobId: "job-1", candidateToken: "signed:fixture:shanghai" },
  });
  expect(confirmed.statusCode).toBe(200);
  expect(selectCandidate).toHaveBeenCalledWith(ownerId, "job-1", "signed:fixture:shanghai", 3);
});
