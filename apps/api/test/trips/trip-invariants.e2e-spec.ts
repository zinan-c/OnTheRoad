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

const ownerA = `tc-b02-owner-a-${randomUUID()}`;
const ownerB = `tc-b02-owner-b-${randomUUID()}`;
let service: TripService;

describe("TC-B02-02 version, owner and database constraints", () => {
  beforeAll(async () => {
    await prepareTripDatabase();
    if (!tripDatabaseUrl) return;
    service = new TripService(new PostgresTripRepository({ databaseUrl: tripDatabaseUrl }));
  });

  afterAll(async () => {
    if (!tripDatabaseUrl) return;
    await cleanOwner(ownerA);
    await cleanOwner(ownerB);
  });

  liveTripTest("rejects stale versions and hides cross-owner resources", async () => {
    const created = await service.createTrip(
      ownerA,
      {
        name: "Owner A",
        startDate: "2026-10-01",
        endDate: "2026-10-02",
        travelers: 1,
        defaultCurrency: "CNY",
        timezone: "Asia/Shanghai",
        mapProfile: "cn_primary",
        destinations: [{ name: "上海" }],
      },
      { idempotencyKey: "tc-b02-owner-a-create" },
    );
    await service.updateTrip(ownerA, created.id, { name: "newer" }, { expectedVersion: 1 });

    await expect(
      service.updateTrip(ownerA, created.id, { name: "stale" }, { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
    await expect(service.getTrip(ownerB, created.id)).rejects.toMatchObject({
      code: "TRIP_NOT_FOUND",
      status: 404,
    });
    await expect(
      service.updateTrip(ownerB, created.id, { name: "stolen" }, { expectedVersion: 2 }),
    ).rejects.toMatchObject({ code: "TRIP_NOT_FOUND", status: 404 });
  });

  liveTripTest("enforces date, profile and destination order in PostgreSQL", async () => {
    const id = randomUUID();
    const directOwner = `tc-b02-db-${randomUUID()}`;
    const baseColumns =
      "id, owner_id, name, start_date, end_date, travelers, default_currency, timezone, map_profile";

    await expect(
      psql(
        `INSERT INTO trip (${baseColumns}) VALUES ('${id}', '${directOwner}', 'bad date', '2026-10-05', '2026-10-01', 1, 'CNY', 'UTC', 'cn_primary')`,
      ),
    ).rejects.toThrow();
    await expect(
      psql(
        `INSERT INTO trip (${baseColumns}) VALUES ('${id}', '${directOwner}', 'bad profile', '2026-10-01', '2026-10-05', 1, 'CNY', 'UTC', 'unknown')`,
      ),
    ).rejects.toThrow();

    const trip = await service.createTrip(
      directOwner,
      {
        name: "order check",
        startDate: "2026-10-01",
        endDate: "2026-10-02",
        travelers: 1,
        defaultCurrency: "CNY",
        timezone: "UTC",
        mapProfile: "international_primary",
        destinations: [{ name: "one" }],
      },
      { idempotencyKey: "tc-b02-order-create" },
    );
    await expect(
      psql(
        `INSERT INTO destination (trip_id, name, sort_order) VALUES ('${trip.id}', 'duplicate', 0)`,
      ),
    ).rejects.toThrow();
    await cleanOwner(directOwner);
  });
});
