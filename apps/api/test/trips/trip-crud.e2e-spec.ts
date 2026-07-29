import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect } from "vitest";

import { PostgresTripRepository } from "../../src/modules/trips/postgres-repository.mjs";
import { TripService } from "../../src/modules/trips/service.mjs";
import { parseTripResponse } from "../../../../packages/contracts/src/generated/index.mjs";
import {
  cleanOwner,
  liveTripTest,
  prepareTripDatabase,
  tripDatabaseUrl,
} from "./postgres-harness.mjs";

const ownerId = `tc-b02-crud-${randomUUID()}`;
let repository: PostgresTripRepository;
let service: TripService;

describe("TC-B02-01 Trip/Destination CRUD", () => {
  beforeAll(async () => {
    await prepareTripDatabase();
    if (!tripDatabaseUrl) return;
    repository = new PostgresTripRepository({ databaseUrl: tripDatabaseUrl });
    service = new TripService(repository);
  });

  afterAll(async () => {
    if (tripDatabaseUrl) await cleanOwner(ownerId);
  });

  liveTripTest("persists, filters, updates, soft-deletes and restores every field", async () => {
    const input = {
      name: "上海—舟山",
      startDate: "2026-10-01",
      endDate: "2026-10-05",
      travelers: 2,
      defaultCurrency: "RMB",
      budget: "9000.00",
      timezone: "Asia/Shanghai",
      mapProfile: "cn_primary",
      description: "海风行程",
      destinations: [
        { name: "上海", countryCode: "CN", city: "上海" },
        { name: "舟山", countryCode: "CN", city: "舟山" },
      ],
    };
    const created = await service.createTrip(ownerId, input, {
      idempotencyKey: "tc-b02-create-1",
    });
    const replayed = await service.createTrip(ownerId, input, {
      idempotencyKey: "tc-b02-create-1",
    });

    expect(replayed).toEqual(created);
    expect(created).toMatchObject({
      ...input,
      defaultCurrency: "CNY",
      budget: "9000.00",
      totalDays: 5,
      status: "active",
      version: 1,
    });
    expect(created.destinations.map(({ name, sortOrder }) => ({ name, sortOrder }))).toEqual([
      { name: "上海", sortOrder: 0 },
      { name: "舟山", sortOrder: 1 },
    ]);
    expect(parseTripResponse(created)).toEqual(created);

    const fetched = await service.getTrip(ownerId, created.id);
    expect(fetched).toEqual(created);
    const page = await service.listTrips(ownerId, {
      search: "舟山",
      currency: "CNY",
      status: "active",
      limit: 10,
    });
    expect(page.items.map((trip) => trip.id)).toEqual([created.id]);

    const updated = await service.updateTrip(
      ownerId,
      created.id,
      { name: "上海—舟山—普陀山", budget: "9800.50" },
      { expectedVersion: created.version },
    );
    expect(updated).toMatchObject({
      name: "上海—舟山—普陀山",
      budget: "9800.50",
      version: 2,
    });

    const deleted = await service.deleteTrip(ownerId, created.id, {
      expectedVersion: updated.version,
    });
    expect(deleted).toMatchObject({ status: "deleted", version: 3 });
    await expect(service.getTrip(ownerId, created.id)).rejects.toMatchObject({
      code: "TRIP_NOT_FOUND",
      status: 404,
    });

    const restored = await service.restoreTrip(ownerId, created.id, {
      expectedVersion: deleted.version,
    });
    expect(restored).toMatchObject({ status: "active", version: 4 });
    expect(await service.getTrip(ownerId, created.id)).toEqual(restored);
  });
});
