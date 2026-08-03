import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { PostgresTransportModeRepository } from "../../src/modules/itinerary/transport-mode-postgres-repository.mjs";
import {
  InMemoryTransportModeRepository,
  TransportModeService,
} from "../../src/modules/itinerary/transport-modes.js";
import {
  applyMigration,
  cleanOwner,
  itineraryDatabaseUrl,
  prepareItineraryDatabase,
  psql,
} from "./postgres-harness.mjs";

const liveTest = itineraryDatabaseUrl ? test : test.skip;
const liveOwner = "tc-b09-transport-mode-owner";

beforeAll(async () => {
  if (!itineraryDatabaseUrl) return;
  await prepareItineraryDatabase();
  const managedSchema = Boolean(
    await psql("SELECT to_regclass('public.otr_schema_migration')"),
  );
  if (!managedSchema) {
    await applyMigration("packages/database/src/migrations/0008_transport_mode.sql");
  }
  await cleanOwner(liveOwner);
});
afterAll(async () => cleanOwner(liveOwner));

describe("TC-B09-01 custom Mode CRUD", () => {
  test("creates, lists, edits and deactivates a trip-scoped visual Mode", async () => {
    const repository = new InMemoryTransportModeRepository({
      trips: [
        { id: "trip-a", ownerId: "owner-a" },
        { id: "trip-b", ownerId: "owner-b" },
      ],
    });
    const service = new TransportModeService(repository);

    const created = await service.create("owner-a", "trip-a", {
      code: "ISLAND_BUGGY",
      label: "海岛接驳车",
      icon: "shuttle-van",
      color: "#12A594",
      lineStyle: "dashed",
    });
    expect(created).toMatchObject({
      tripId: "trip-a",
      ownerId: "owner-a",
      code: "ISLAND_BUGGY",
      label: "海岛接驳车",
      icon: "shuttle-van",
      color: "#12A594",
      lineStyle: "dashed",
      isSystem: false,
      enabled: true,
      referenced: false,
      version: 1,
    });

    const updated = await service.update(
      "owner-a",
      "trip-a",
      created.id,
      {
        label: "海岛电瓶车",
        icon: "car-side",
        color: "#027A48",
        lineStyle: "dotted",
      },
      { expectedVersion: 1 },
    );
    expect(updated).toMatchObject({
      code: "ISLAND_BUGGY",
      label: "海岛电瓶车",
      icon: "car-side",
      color: "#027A48",
      lineStyle: "dotted",
      version: 2,
    });

    const listed = await service.list("owner-a", "trip-a");
    expect(listed.some(({ code, isSystem }) => code === "WALK" && isSystem)).toBe(true);
    expect(listed.find(({ id }) => id === created.id)).toMatchObject(updated);

    const disabled = await service.deactivate(
      "owner-a",
      "trip-a",
      created.id,
      { expectedVersion: 2 },
    );
    expect(disabled).toMatchObject({ enabled: false, version: 3 });
  });

  test("rejects conflicting codes and invalid visual fields", async () => {
    const service = new TransportModeService(
      new InMemoryTransportModeRepository({
        trips: [{ id: "trip-a", ownerId: "owner-a" }],
      }),
    );
    await expect(
      service.create("owner-a", "trip-a", {
        code: "WALK",
        label: "覆盖步行",
        icon: "person",
        color: "#FFFFFF",
        lineStyle: "solid",
      }),
    ).rejects.toMatchObject({ code: "TRANSPORT_MODE_CODE_CONFLICT", status: 409 });
    await expect(
      service.create("owner-a", "trip-a", {
        code: "bad code",
        label: "",
        icon: "<svg>",
        color: "red",
        lineStyle: "wave",
      }),
    ).rejects.toMatchObject({ code: "TRANSPORT_MODE_INVALID", status: 400 });
  });

  liveTest("persists custom Mode CRUD through PostgreSQL and owner scope", async () => {
    const tripId = await psql(
      `INSERT INTO trip (
        owner_id, name, start_date, end_date, travelers,
        default_currency, timezone, map_profile
      )
      VALUES (
        '${liveOwner}', 'B09 database trip', DATE '2026-10-01',
        DATE '2026-10-02', 1, 'CNY', 'Asia/Shanghai', 'cn_primary'
      )
      RETURNING id`,
    );
    const service = new TransportModeService(
      new PostgresTransportModeRepository({ databaseUrl: itineraryDatabaseUrl }),
    );
    const created = await service.create(liveOwner, tripId, {
      code: "DB_SHUTTLE",
      label: "数据库接驳",
      icon: "shuttle-van",
      color: "#175CD3",
      lineStyle: "dashed",
    });
    expect(await service.resolve(liveOwner, tripId, "DB_SHUTTLE"))
      .toMatchObject({ id: created.id, ownerId: liveOwner, tripId });
    const updated = await service.update(
      liveOwner,
      tripId,
      created.id,
      { label: "数据库电瓶车", color: "#027A48" },
      { expectedVersion: 1 },
    );
    expect(updated).toMatchObject({
      label: "数据库电瓶车",
      color: "#027A48",
      version: 2,
    });
    await expect(
      service.list("different-owner", tripId),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await service.deactivate(
        liveOwner,
        tripId,
        created.id,
        { expectedVersion: 2 },
      ),
    ).toMatchObject({ enabled: false, version: 3 });
  });
});
