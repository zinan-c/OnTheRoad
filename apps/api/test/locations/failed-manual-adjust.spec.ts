import { afterAll, beforeAll, expect, test } from "vitest";

import { CoordinateAdjustmentService } from "@on-the-road/application/location";
import { PostgresCoordinateRepository } from "../../src/modules/locations/coordinates-postgres.mjs";
import { PostgresLocationRepository } from "../../src/modules/locations/postgres-repository.mjs";
import {
  cleanTrip,
  liveLocationTest,
  locationDatabaseUrl,
  prepareLocationDatabase,
} from "./postgres-harness.mjs";

const ownerId = "e2e-015-failed-manual-owner";
let tripId: string | undefined;

beforeAll(async () => {
  if (locationDatabaseUrl) tripId = await prepareLocationDatabase(ownerId);
});

afterAll(async () => {
  if (tripId) await cleanTrip(tripId);
});

liveLocationTest("E2E-015 allows an explicit manual point after provider failure", async () => {
  const locations = new PostgresLocationRepository({ databaseUrl: locationDatabaseUrl });
  const repository = new PostgresCoordinateRepository({ locationRepository: locations });
  const service = new CoordinateAdjustmentService(repository);
  const created = await locations.create({ ownerId, tripId, inputText: "外滩附近", name: "外滩附近" });
  const resolving = await locations.transition(ownerId, created.id, created.version, "resolving");
  const failed = await locations.transition(ownerId, created.id, resolving.version, "failed");

  await expect(service.manuallyEnter(ownerId, created.id, failed.version, {
    longitude: 121.51, latitude: 31.22, crs: "WGS84",
  })).resolves.toMatchObject({
    status: "resolved", version: failed.version + 1, manuallyAdjusted: true,
    point: { longitude: 121.51, latitude: 31.22, crs: "WGS84" },
  });
  await locations.close();
});
