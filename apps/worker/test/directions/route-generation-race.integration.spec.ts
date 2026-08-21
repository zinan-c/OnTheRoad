import { afterEach, describe, expect, test } from "vitest";

import { PostgresExecutor } from "@on-the-road/database/postgres";
import type { JobEvent } from "@on-the-road/database/jobs";
import { createFixtureProvider } from "@on-the-road/providers";
import { PostgresRouteRebuildProcessor } from "../../src/processors/directions/postgres-route-rebuild.js";

const databaseUrl = process.env.OTR_C07_DATABASE_URL
  ?? process.env.OTR_M3_DATABASE_URL;
const liveTest = databaseUrl ? test : test.skip;
const ownerId = "m3-c07-route-race";
let database: PostgresExecutor | undefined;
let apiDatabase: PostgresExecutor | undefined;
const processors: PostgresRouteRebuildProcessor[] = [];
const directions = createFixtureProvider().directions;

afterEach(async () => {
  if (database) {
    await database.query("DELETE FROM trip WHERE owner_id = $1", [ownerId]);
    await database.close();
    database = undefined;
  }
  if (apiDatabase) {
    await apiDatabase.close();
    apiDatabase = undefined;
  }
  await Promise.all(processors.splice(0).map((processor) => processor.close()));
});

describe("TC-C07-02 generation/sourceVersion race", () => {
  liveTest("keeps the newest source generation active and discards a late rebuild", async () => {
    database = new PostgresExecutor({ databaseUrl, role: "worker" });
    const context = await seedRouteContext(database);
    const oldEvent = await latestRouteEvent(database, context.dayId);

    let releaseOld!: () => void;
    let oldLoaded!: () => void;
    const oldPaused = new Promise<void>((resolve) => {
      oldLoaded = resolve;
    });
    const oldRelease = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const oldProcessor = new PostgresRouteRebuildProcessor(databaseUrl!, {
      directions,
      providerName: "fixture",
      beforeCommit: async () => {
        oldLoaded();
        await oldRelease;
      },
    });
    processors.push(oldProcessor);
    const oldBuild = oldProcessor.process(oldEvent);
    await oldPaused;

    await database.query(
      `UPDATE location
       SET geom = ST_SetSRID(ST_MakePoint(121.5000, 31.2000), 4326),
           version = version + 1,
           updated_at = now()
       WHERE id = $1::uuid`,
      [context.secondLocationId],
    );
    const newEvent = await latestRouteEvent(database, context.dayId);
    const newProcessor = new PostgresRouteRebuildProcessor(databaseUrl!, {
      directions,
      providerName: "fixture",
    });
    processors.push(newProcessor);

    await expect(newProcessor.process(newEvent)).resolves.toMatchObject({
      eventId: newEvent.eventId,
      applied: true,
    });
    releaseOld();
    await expect(oldBuild).resolves.toMatchObject({
      eventId: oldEvent.eventId,
      applied: false,
    });

    const active = (await database.query<{
      status: string;
      source_version: string;
      destination_longitude: number;
    }>(
      `SELECT status, source_version,
              ST_X(ST_EndPoint(route_geometry)::geometry) AS destination_longitude
       FROM route_segment
       WHERE trip_id = $1::uuid
         AND status <> 'obsolete'`,
      [context.tripId],
    )).rows;
    expect(active).toHaveLength(1);
    expect(active[0]?.status).toBe("resolved");
    expect(active[0]?.source_version).toMatch(/^[0-9a-f]{64}$/u);
    expect(Number(active[0]?.destination_longitude)).toBeCloseTo(121.5, 4);
  });
});

describe("route rebuild lock ordering", () => {
  liveTest("serializes a concurrent itinerary deletion without deadlocking", async () => {
    database = new PostgresExecutor({ databaseUrl, role: "worker" });
    apiDatabase = new PostgresExecutor({ databaseUrl, role: "api" });
    const context = await seedRouteContext(database);
    const event = await latestRouteEvent(database, context.dayId);

    let releaseGenerationLock!: () => void;
    let generationLocked!: () => void;
    const generationLockReached = new Promise<void>((resolve) => {
      generationLocked = resolve;
    });
    const generationLockRelease = new Promise<void>((resolve) => {
      releaseGenerationLock = resolve;
    });
    const processor = new PostgresRouteRebuildProcessor(databaseUrl!, {
      directions,
      providerName: "fixture",
      afterGenerationLock: async () => {
        generationLocked();
        await generationLockRelease;
      },
    });
    processors.push(processor);

    const rebuild = processor.process(event);
    await generationLockReached;
    const deletion = apiDatabase.query(
      "SELECT delete_itinerary_item($1, $2::uuid, $3::uuid, 1)",
      [ownerId, context.tripId, context.firstItemId],
    );
    try {
      await expect.poll(async () => {
        const row = (await database!.query<{ wait_event_type: string | null }>(
          `SELECT wait_event_type
           FROM pg_stat_activity
           WHERE application_name = 'on-the-road-api'
             AND query LIKE 'SELECT delete_itinerary_item%'
             AND state = 'active'`,
        )).rows[0];
        return row?.wait_event_type;
      }).toBe("Lock");
    } finally {
      releaseGenerationLock();
    }
    await expect(rebuild).resolves.toMatchObject({ applied: true });
    await expect(deletion).resolves.toMatchObject({ rowCount: 1 });
  });
});

async function seedRouteContext(database: PostgresExecutor) {
  const tripId = "00000000-0000-4000-8000-000000000701";
  const firstLocationId = "00000000-0000-4000-8000-000000000711";
  const secondLocationId = "00000000-0000-4000-8000-000000000712";
  await database.query(
    `INSERT INTO trip (
       id, owner_id, name, start_date, end_date, default_currency, timezone
     ) VALUES ($1::uuid, $2, 'C07 race', '2026-09-01', '2026-09-01', 'CNY', 'Asia/Shanghai')`,
    [tripId, ownerId],
  );
  const dayId = (await database.query<{ id: string }>(
    "SELECT id FROM trip_day WHERE trip_id = $1::uuid",
    [tripId],
  )).rows[0]!.id;
  await database.query(
    `INSERT INTO location (
       id, trip_id, owner_id, input_text, name, geom,
       provider, source_crs, geocoding_status
     ) VALUES
       ($1::uuid, $3::uuid, $4, 'A', 'A',
        ST_SetSRID(ST_MakePoint(121.4800, 31.2000), 4326),
        'fixture', 'EPSG:4326', 'resolved'),
       ($2::uuid, $3::uuid, $4, 'B', 'B',
        ST_SetSRID(ST_MakePoint(121.4900, 31.2000), 4326),
        'fixture', 'EPSG:4326', 'resolved')`,
    [firstLocationId, secondLocationId, tripId, ownerId],
  );
  await database.query(
    `INSERT INTO itinerary_item (
       id, trip_id, owner_id, trip_day_id, item_type, time_kind,
       target, location_id, sort_order
     ) VALUES
       ('00000000-0000-4000-8000-000000000721', $1::uuid, $2, $3::uuid,
        'attraction', 'unscheduled', 'A', $4::uuid, 1024),
       ('00000000-0000-4000-8000-000000000722', $1::uuid, $2, $3::uuid,
        'attraction', 'unscheduled', 'B', $5::uuid, 2048)`,
    [tripId, ownerId, dayId, firstLocationId, secondLocationId],
  );
  return {
    tripId,
    dayId,
    firstItemId: "00000000-0000-4000-8000-000000000721",
    secondLocationId,
  };
}

async function latestRouteEvent(
  database: PostgresExecutor,
  dayId: string,
): Promise<JobEvent> {
  const row = (await database.query<{
    event_id: string;
    event_type: string;
    aggregate_id: string;
    aggregate_type: string;
    aggregate_version: number;
    schema_version: number;
  }>(
    `SELECT event_id, event_type, aggregate_id, aggregate_type,
            aggregate_version, schema_version
     FROM job_outbox
     WHERE event_type = 'route.rebuild.requested'
       AND aggregate_id = $1
     ORDER BY aggregate_version DESC
     LIMIT 1`,
    [dayId],
  )).rows[0]!;
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    aggregateId: row.aggregate_id,
    aggregateType: row.aggregate_type,
    aggregateVersion: row.aggregate_version,
    schemaVersion: row.schema_version,
  };
}
