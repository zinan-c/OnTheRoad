import { afterEach, expect, test } from "vitest";
import { createHash } from "node:crypto";

import { createApiApplication } from "../../src/app.js";
import { IdentityService } from "../../src/modules/identity/service.mjs";
import {
  InMemoryTransportModeRepository,
  TransportModeService,
} from "../../src/modules/itinerary/transport-modes.js";
import type { ApiRuntime } from "../../src/runtime.js";

let app: Awaited<ReturnType<typeof createApiApplication>> | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

test("E2E-013 exposes the custom transport Mode lifecycle as owner-scoped routes", async () => {
  const identity = new IdentityService({
    environment: "development",
    developmentIdentityEnabled: true,
    appOrigin: "http://localhost:3000",
    signingKeys: { active: { id: "mode-route-v1", secret: "mode-route-secret-at-least-32-characters" } },
  });
  const ownerId = createHash("sha256")
    .update("https://dev-identity.local/\u0000mode-owner")
    .digest("base64url");
  const transportModes = new TransportModeService(new InMemoryTransportModeRepository({
    trips: [{ id: "trip-1", ownerId }],
  }));
  app = await createApiApplication({
    appOrigin: "http://localhost:3000",
    environment: "development",
    identity,
    transportModes,
    referenceData: () => ({}),
    checkReadiness: async () => ({ test: true }),
    close: async () => {},
  } as unknown as ApiRuntime);
  const server = app.getHttpAdapter().getInstance();
  const login = await server.inject({
    method: "POST",
    url: "/api/v1/identity/development-session",
    headers: { origin: "http://localhost:3000" },
    payload: { subject: "mode-owner" },
  });
  const cookie = login.headers["set-cookie"]?.split(";")[0];

  const created = await server.inject({
    method: "POST",
    url: "/api/v1/trips/trip-1/transport-modes",
    headers: { cookie },
    payload: { code: "CABLE_SHUTTLE_CUSTOM", label: "缆车接驳", icon: "cable-car", color: "#123456", lineStyle: "dotted" },
  });
  expect(created.statusCode).toBe(201);
  expect(created.json()).toMatchObject({ code: "CABLE_SHUTTLE_CUSTOM", version: 1 });
  const listed = await server.inject({ method: "GET", url: "/api/v1/trips/trip-1/transport-modes", headers: { cookie } });
  expect(listed.json()).toContainEqual(expect.objectContaining({ code: "CABLE_SHUTTLE_CUSTOM" }));

  const disabled = await server.inject({
    method: "DELETE",
    url: `/api/v1/trips/trip-1/transport-modes/${created.json().id}`,
    headers: { cookie, "if-match": "1" },
  });
  expect(disabled.statusCode).toBe(200);
  expect(disabled.json()).toMatchObject({ enabled: false, version: 2 });
});
