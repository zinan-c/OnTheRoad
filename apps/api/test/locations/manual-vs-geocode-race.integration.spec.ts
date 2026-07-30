import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";

import {
  CoordinateAdjustmentService,
  InMemoryCoordinateRepository,
} from "../../../../packages/application/src/location/adjust-coordinates.js";
import {
  PostgresCoordinateRepository,
} from "../../src/modules/locations/coordinates-postgres.mjs";
import { PostgresLocationRepository } from "../../src/modules/locations/postgres-repository.mjs";
import {
  cleanTrip,
  liveLocationTest,
  locationDatabaseUrl,
  prepareLocationDatabase,
} from "./postgres-harness.mjs";

const liveOwnerId = `tc-c06-${randomUUID()}`;
let liveTripId: string | undefined;

beforeAll(async () => {
  if (locationDatabaseUrl) liveTripId = await prepareLocationDatabase(liveOwnerId);
});
afterAll(async () => {
  if (liveTripId) await cleanTrip(liveTripId);
});

test("TC-C06-02 late geocode cannot overwrite manual point", async () => {
  const repository = new InMemoryCoordinateRepository([{
    id: "location-race",
    ownerId: "owner-1",
    version: 4,
    status: "resolving",
    point: null,
    manuallyAdjusted: false,
  }]);
  const service = new CoordinateAdjustmentService(repository);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const late = (async () => {
    await barrier;
    return service.applyGeocodeResult("owner-1", "location-race", 4, {
      point: { longitude: 120, latitude: 30, crs: "WGS84" },
      label: "late provider",
    });
  })();

  const manual = await service.dragMarker(
    "owner-1",
    "location-race",
    4,
    { longitude: 121.5, latitude: 31.2, crs: "WGS84" },
  );
  release();
  const lateResult = await late;

  expect(manual).toMatchObject({ version: 5, manuallyAdjusted: true });
  expect(lateResult).toEqual({ affectedRows: 0, discarded: true });
  expect(await repository.get("owner-1", "location-race")).toMatchObject({
    version: 5,
    point: { longitude: 121.5, latitude: 31.2 },
    manuallyAdjusted: true,
  });
});

test("TC-C06-02 concurrent drags enforce If-Match and commit exactly one point", async () => {
  const repository = new InMemoryCoordinateRepository([{
    id: "location-concurrent",
    ownerId: "owner-1",
    version: 2,
    status: "resolved",
    point: { longitude: 0, latitude: 0, crs: "WGS84" },
    manuallyAdjusted: false,
  }]);
  const service = new CoordinateAdjustmentService(repository);
  const writes = await Promise.allSettled([
    service.dragMarker("owner-1", "location-concurrent", 2, {
      longitude: 121,
      latitude: 31,
      crs: "WGS84",
    }),
    service.dragMarker("owner-1", "location-concurrent", 2, {
      longitude: 122,
      latitude: 32,
      crs: "WGS84",
    }),
  ]);
  expect(writes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
  expect(writes.filter(({ status }) => status === "rejected")).toHaveLength(1);
  expect(await repository.get("owner-1", "location-concurrent")).toMatchObject({
    version: 3,
    manuallyAdjusted: true,
  });
});

liveLocationTest("TC-C06-02 PostgreSQL CAS reports zero affected rows for late geocode", async () => {
  const base = new PostgresLocationRepository({ databaseUrl: locationDatabaseUrl });
  const created = await base.create({
    ownerId: liveOwnerId,
    tripId: liveTripId,
    inputText: "race",
    name: "race",
  });
  const resolving = await base.transition(
    liveOwnerId,
    created.id,
    created.version,
    "resolving",
  );
  const repository = new PostgresCoordinateRepository({ locationRepository: base });
  const service = new CoordinateAdjustmentService(repository);
  await service.dragMarker(liveOwnerId, created.id, resolving.version, {
    longitude: 121.5,
    latitude: 31.2,
    crs: "WGS84",
  });
  await expect(service.applyGeocodeResult(
    liveOwnerId,
    created.id,
    resolving.version,
    {
      point: { longitude: 120, latitude: 30, crs: "WGS84" },
      label: "late",
    },
  )).resolves.toEqual({ affectedRows: 0, discarded: true });
  await expect(repository.get(liveOwnerId, created.id)).resolves.toMatchObject({
    version: resolving.version + 1,
    point: { longitude: 121.5, latitude: 31.2 },
    manuallyAdjusted: true,
  });
  await expect(repository.audits(liveOwnerId, created.id)).resolves.toEqual([
    expect.objectContaining({
      action: "location.coordinates.marker-dragged",
      fromVersion: resolving.version,
      toVersion: resolving.version + 1,
      point: { longitude: 121.5, latitude: 31.2, crs: "WGS84" },
    }),
  ]);
});
