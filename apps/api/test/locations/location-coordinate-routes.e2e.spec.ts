import { createHash } from "node:crypto";
import { afterEach, expect, test } from "vitest";

import { CoordinateAdjustmentService, InMemoryCoordinateRepository } from "@on-the-road/application/location";
import { createApiApplication } from "../../src/app.js";
import { IdentityService } from "../../src/modules/identity/service.mjs";
import { LocationCoordinatesApi } from "../../src/modules/locations/coordinates.js";
import type { ApiRuntime } from "../../src/runtime.js";

let app: Awaited<ReturnType<typeof createApiApplication>> | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

test("E2E-015 records all three coordinate paths and discards a late geocode result", async () => {
  const ownerId = createHash("sha256").update("https://dev-identity.local/\u0000coordinate-owner").digest("base64url");
  const repository = new InMemoryCoordinateRepository([{
    id: "location-1", ownerId, version: 1, status: "unresolved", point: null, manuallyAdjusted: false,
  }]);
  const service = new CoordinateAdjustmentService(repository);
  const identity = new IdentityService({
    environment: "development", developmentIdentityEnabled: true, appOrigin: "http://localhost:3000",
    signingKeys: { active: { id: "coordinate-v1", secret: "coordinate-route-secret-at-least-32-characters" } },
  });
  app = await createApiApplication({
    appOrigin: "http://localhost:3000", environment: "development", identity,
    locationCoordinates: new LocationCoordinatesApi(service), referenceData: () => ({}),
    checkReadiness: async () => ({ test: true }), close: async () => {},
  } as unknown as ApiRuntime);
  const server = app.getHttpAdapter().getInstance();
  const login = await server.inject({ method: "POST", url: "/api/v1/identity/development-session", headers: { origin: "http://localhost:3000" }, payload: { subject: "coordinate-owner" } });
  const cookie = login.headers["set-cookie"]?.split(";")[0];
  async function adjust(version: number, payload: Record<string, unknown>) {
    return server.inject({ method: "PATCH", url: "/api/v1/trips/trip-1/locations/location-1/coordinates", headers: { cookie, "if-match": `\"${version}\"` }, payload });
  }

  const picked = await adjust(1, { longitude: 121.49, latitude: 31.24, adjustmentKind: "map-pick", inputMode: "mouse" });
  const dragged = await adjust(2, { longitude: 121.5, latitude: 31.23, adjustmentKind: "marker-drag", inputMode: "touch" });
  const manual = await adjust(3, { longitude: 121.51, latitude: 31.22, adjustmentKind: "manual", inputMode: "manual" });
  expect([picked.statusCode, dragged.statusCode, manual.statusCode]).toEqual([200, 200, 200]);
  expect(manual.json()).toMatchObject({ version: 4, manuallyAdjusted: true, point: { longitude: 121.51, latitude: 31.22, crs: "WGS84" } });
  expect(repository.audits(ownerId, "location-1").map(({ action, inputMode }) => ({ action, inputMode }))).toEqual([
    { action: "location.coordinates.map-picked", inputMode: "mouse" },
    { action: "location.coordinates.marker-dragged", inputMode: "touch" },
    { action: "location.coordinates.manually-entered", inputMode: "manual" },
  ]);
  await expect(service.applyGeocodeResult(ownerId, "location-1", 1, {
    point: { longitude: 120, latitude: 30, crs: "WGS84" }, label: "晚到旧结果",
  })).resolves.toEqual({ affectedRows: 0, discarded: true });
});
