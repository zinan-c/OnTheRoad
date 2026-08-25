import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect } from "vitest";

import { PostgresTripRepository } from "../../src/modules/trips/postgres-repository.mjs";
import { TripService } from "../../src/modules/trips/service.mjs";
import {
  cleanOwner,
  liveTripTest,
  prepareTripDatabase,
  psql,
  tripDatabaseUrl,
} from "./postgres-harness.mjs";

const ownerId = `trip-activity-${randomUUID()}`;
let service: TripService;

describe("Trip recent activity ordering integration", () => {
  beforeAll(async () => {
    await prepareTripDatabase();
    if (!tripDatabaseUrl) return;
    service = new TripService(new PostgresTripRepository({ databaseUrl: tripDatabaseUrl }));
  });

  afterAll(async () => {
    if (tripDatabaseUrl) await cleanOwner(ownerId);
  });

  liveTripTest("moves a Trip to the front when a child resource changes", async () => {
    const first = await service.createTrip(ownerId, tripInput("Activity A"), {
      idempotencyKey: "activity-a",
    });
    await psql("SELECT pg_sleep(0.01)");
    const second = await service.createTrip(ownerId, tripInput("Activity B"), {
      idempotencyKey: "activity-b",
    });

    expect((await recentIds()).slice(0, 2)).toEqual([second.id, first.id]);
    const before = await service.getTrip(ownerId, first.id);

    await psql("SELECT pg_sleep(0.01)");
    await psql(`UPDATE destination SET name = 'Activity A updated' WHERE trip_id = '${first.id}'::uuid`);

    const after = await service.getTrip(ownerId, first.id);
    expect(Date.parse(after.lastActivityAt)).toBeGreaterThan(Date.parse(before.lastActivityAt));
    expect(after.updatedAt).toBe(before.updatedAt);
    expect((await recentIds()).slice(0, 2)).toEqual([first.id, second.id]);
  });
});

function tripInput(name: string) {
  return {
    name,
    startDate: "2026-10-01",
    endDate: "2026-10-02",
    travelers: 2,
    defaultCurrency: "CNY",
    timezone: "Asia/Shanghai",
    mapProfile: "cn_primary",
    destinations: [{ name: `${name} destination`, countryCode: "CN" }],
  };
}

async function recentIds(): Promise<string[]> {
  const page = await service.listTrips(ownerId, {
    status: "active",
    sort: "lastActivityAt",
    order: "desc",
    limit: 20,
  });
  return page.items.map(({ id }) => id);
}
