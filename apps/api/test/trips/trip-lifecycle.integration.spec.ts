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

const ownerId = `trip-lifecycle-${randomUUID()}`;
let service: TripService;
let repository: PostgresTripRepository;

describe("complete Trip lifecycle integration", () => {
  beforeAll(async () => {
    await prepareTripDatabase();
    if (!tripDatabaseUrl) return;
    repository = new PostgresTripRepository({ databaseUrl: tripDatabaseUrl });
    service = new TripService(repository);
  });

  afterAll(async () => {
    if (tripDatabaseUrl) await cleanOwner(ownerId);
  });

  liveTripTest("runs Draft through Active, Archived, Trash and safe restore", async () => {
    const draft = await service.createTrip(ownerId, tripInput(), {
      idempotencyKey: "lifecycle-chain",
    });
    expect(draft).toMatchObject({ status: "draft", version: 1 });

    const active = await service.transitionTrip(ownerId, draft.id, "active", {
      expectedVersion: draft.version,
    });
    const archived = await service.transitionTrip(ownerId, draft.id, "archived", {
      expectedVersion: active.version,
    });
    const deleted = await service.deleteTrip(ownerId, draft.id, {
      expectedVersion: archived.version,
    });
    expect(deleted).toMatchObject({ id: draft.id, status: "deleted", version: 4 });
    expect(await psql(`SELECT status_before_delete FROM trip WHERE id = '${draft.id}'::uuid`))
      .toBe("archived");

    await expect(service.transitionTrip(ownerId, draft.id, "active", {
      expectedVersion: deleted.version,
    })).rejects.toMatchObject({ code: "INVALID_TRIP_TRANSITION", status: 409 });

    const restored = await service.restoreTrip(ownerId, draft.id, {
      expectedVersion: deleted.version,
    });
    expect(restored).toMatchObject({ id: draft.id, status: "archived", version: 5 });
    expect(await psql(`SELECT count(*) FROM destination WHERE trip_id = '${draft.id}'::uuid`))
      .toBe("1");

    const reactivated = await service.transitionTrip(ownerId, draft.id, "active", {
      expectedVersion: restored.version,
    });
    expect(reactivated).toMatchObject({ id: draft.id, status: "active", version: 6 });
    expect((await repository.listAudit(ownerId, draft.id)).map(({ action }) => action)).toEqual([
      "trip.created",
      "trip.updated",
      "trip.updated",
      "trip.deleted",
      "trip.restored",
      "trip.updated",
    ]);
  });
});

function tripInput() {
  return {
    name: "Lifecycle chain",
    startDate: "2026-10-01",
    endDate: "2026-10-02",
    travelers: 2,
    defaultCurrency: "CNY",
    timezone: "Asia/Shanghai",
    mapProfile: "cn_primary",
    status: "draft",
    destinations: [{ name: "Shanghai", countryCode: "CN" }],
  };
}
