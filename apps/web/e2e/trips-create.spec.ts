import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";

import { PostgresTripRepository } from "../../api/src/modules/trips/postgres-repository.mjs";
import { TripService } from "../../api/src/modules/trips/service.mjs";
import {
  cleanOwner,
  prepareTripDatabase,
  tripDatabaseUrl,
} from "../../api/test/trips/postgres-harness.mjs";
import { TripsController } from "../src/features/trips/trips-controller.js";

const liveWebTest = tripDatabaseUrl ? test : test.skip;
const ownerId = `tc-b04-${randomUUID()}`;

beforeAll(prepareTripDatabase);
afterAll(async () => {
  if (tripDatabaseUrl) await cleanOwner(ownerId);
});

liveWebTest("TC-B04-03 creates from an empty account and survives reload/re-login", async () => {
  const gateway = createGateway();
  const firstSession = new TripsController(gateway);
  expect(await firstSession.load()).toEqual([]);

  const created = await firstSession.submit({
    name: "海岛五日",
    startDate: "2026-10-01",
    endDate: "2026-10-05",
    travelers: 2,
    defaultCurrency: "CNY",
    budget: "9000.00",
    timezone: "Asia/Shanghai",
    mapProfile: "cn_primary",
    destinations: [{ name: "上海", countryCode: "CN" }, { name: "舟山", countryCode: "CN" }],
  }, "tc-b04-create");

  expect(firstSession.dayOneLocation(created)).toBe(`/trips/${created.id}/days/1`);

  const reloadedSession = new TripsController(createGateway());
  const reloaded = await reloadedSession.load();
  expect(reloaded).toHaveLength(1);
  expect(reloaded[0]).toMatchObject({ id: created.id, totalDays: 5, name: "海岛五日" });
});

function createGateway() {
  const service = new TripService(new PostgresTripRepository({ databaseUrl: tripDatabaseUrl! }));
  return {
    createTrip: (input: unknown, options: { idempotencyKey: string }) =>
      service.createTrip(ownerId, input, options),
    listTrips: async () => (await service.listTrips(ownerId)).items,
  };
}
