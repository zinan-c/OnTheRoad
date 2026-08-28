import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, test } from "vitest";

import type { JobEvent } from "../../packages/database/src/schema/jobs.js";
import { PostgresExecutor } from "../../packages/database/src/postgres/index.js";
import { createFixtureProvider } from "../../packages/providers/src/index.js";
import { PostgresRouteRebuildProcessor } from "../../apps/worker/src/processors/directions/postgres-route-rebuild.js";

const databaseUrl = process.env.OTR_C07_DATABASE_URL
  ?? process.env.OTR_M3_DATABASE_URL;
const liveTest = databaseUrl ? test : test.skip;
const ownerId = "m3-c07-rebuild";
const directions = createFixtureProvider().directions;
let database: PostgresExecutor | undefined;
let processor: PostgresRouteRebuildProcessor | undefined;

afterEach(async () => {
  if (database) {
    await database.query("DELETE FROM trip WHERE owner_id = $1", [ownerId]);
    await database.close();
    database = undefined;
  }
  await processor?.close();
  processor = undefined;
});

describe("TC-C07-03 change-to-rebuild E2E", () => {
  liveTest("obsoletes synchronously and rebuilds only the current route after change/redelivery", async () => {
    database = new PostgresExecutor({ databaseUrl, role: "test" });
    processor = new PostgresRouteRebuildProcessor(databaseUrl!, {
      directions,
      providerName: "fixture",
    });
    const context = await seedRoute(database);
    const initialEvent = await latestEvent(database, context.dayId, "route.rebuild.requested");
    await expect(processor.process(initialEvent)).resolves.toMatchObject({ applied: true });
    expect(await activeCount(database, context.tripId)).toBe(2);

    const dayVersion = (await database.query<{ version: number }>(
      "SELECT version FROM trip_day WHERE id = $1::uuid",
      [context.dayId],
    )).rows[0]!.version;
    await database.query(
      `SELECT reorder_itinerary_items($1, $2::uuid, $3::uuid, $4, $5::jsonb)`,
      [
        ownerId,
        context.tripId,
        context.dayId,
        dayVersion,
        JSON.stringify([...context.itemIds].reverse()),
      ],
    );
    expect(await activeCount(database, context.tripId)).toBe(0);

    const reorderTriggerEvent = await latestEvent(
      database,
      context.dayId,
      "route.rebuild.requested",
    );
    await expect(processor.process(reorderTriggerEvent)).resolves.toMatchObject({
      applied: true,
    });
    expect(await activeCount(database, context.tripId)).toBe(2);
    const reorderEvent = await latestEvent(
      database,
      context.dayId,
      "itinerary.order.changed",
    );
    await expect(processor.process(reorderEvent)).resolves.toMatchObject({
      applied: false,
    });
    expect(await activeCount(database, context.tripId)).toBe(2);

    await database.query(
      `UPDATE location
       SET geom = ST_SetSRID(ST_MakePoint(121.5200, 31.2000), 4326),
           version = version + 1
       WHERE id = $1::uuid`,
      [context.locationIds[0]],
    );
    await database.query(
      `UPDATE itinerary_item
       SET transport_mode_code = 'WALK', version = version + 1
       WHERE id = $1::uuid`,
      [context.itemIds[0]],
    );
    expect(await activeCount(database, context.tripId)).toBe(0);
    const changedEvent = await latestEvent(
      database,
      context.dayId,
      "route.rebuild.requested",
    );
    await expect(processor.process(changedEvent)).resolves.toMatchObject({
      applied: true,
    });
    await expect(processor.process(changedEvent)).resolves.toMatchObject({
      applied: false,
    });
    expect(await activeCount(database, context.tripId)).toBe(2);

    await database.query(
      "DELETE FROM itinerary_item WHERE id = $1::uuid",
      [context.itemIds[1]],
    );
    expect(await activeCount(database, context.tripId)).toBe(0);
    await processor.process(await latestEvent(
      database,
      context.dayId,
      "route.rebuild.requested",
    ));
    const active = (await database.query<{
      status: string;
      transport_mode_code: string;
    }>(
      `SELECT status, transport_mode_code
       FROM route_segment
       WHERE trip_id = $1::uuid AND status <> 'obsolete'`,
      [context.tripId],
    )).rows;
    expect(active).toEqual([{ status: "resolved", transport_mode_code: "WALK" }]);
  });
});

async function seedRoute(database: PostgresExecutor) {
  const tripId = randomUUID();
  const locationIds = [randomUUID(), randomUUID(), randomUUID()];
  const itemIds = [randomUUID(), randomUUID(), randomUUID()];
  await database.query(
    `INSERT INTO trip (
       id, owner_id, name, start_date, end_date, default_currency, timezone
     ) VALUES ($1::uuid, $2, 'C07 rebuild',
               '2026-09-01', '2026-09-01', 'CNY', 'Asia/Shanghai')`,
    [tripId, ownerId],
  );
  const dayId = (await database.query<{ id: string }>(
    "SELECT id FROM trip_day WHERE trip_id = $1::uuid",
    [tripId],
  )).rows[0]!.id;
  for (const [index, locationId] of locationIds.entries()) {
    await database.query(
      `INSERT INTO location (
         id, trip_id, owner_id, input_text, name, geom,
         provider, source_crs, geocoding_status
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4, $4,
         ST_SetSRID(ST_MakePoint($5, 31.2000), 4326),
         'fixture', 'EPSG:4326', 'resolved'
       )`,
      [locationId, tripId, ownerId, `P${index + 1}`, 121.48 + index * 0.01],
    );
  }
  for (const [index, itemId] of itemIds.entries()) {
    await database.query(
      `INSERT INTO itinerary_item (
         id, trip_id, owner_id, trip_day_id, item_type,
         time_kind, target, location_id, sort_order
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4::uuid, 'attraction',
         'unscheduled', $5, $6::uuid, $7
       )`,
      [
        itemId,
        tripId,
        ownerId,
        dayId,
        `P${index + 1}`,
        locationIds[index],
        (index + 1) * 1024,
      ],
    );
  }
  return { tripId, dayId, locationIds, itemIds };
}

async function latestEvent(
  database: PostgresExecutor,
  dayId: string,
  eventType: string,
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
     WHERE aggregate_id = $1 AND event_type = $2
     ORDER BY created_at DESC, event_id DESC
     LIMIT 1`,
    [dayId, eventType],
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

async function activeCount(database: PostgresExecutor, tripId: string) {
  return Number((await database.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM route_segment
     WHERE trip_id = $1::uuid AND status <> 'obsolete'`,
    [tripId],
  )).rows[0]?.count ?? "0");
}
