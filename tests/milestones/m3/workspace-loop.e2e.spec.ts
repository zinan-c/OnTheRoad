import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, test } from "vitest";

import { PostgresExecutor } from "../../../packages/database/src/postgres/index.js";
import type { JobEvent } from "../../../packages/database/src/schema/jobs.js";
import { PostgresRouteRebuildProcessor } from "../../../apps/worker/src/processors/directions/postgres-route-rebuild.js";
import {
  AttachmentGalleryService,
} from "../../../apps/api/src/modules/attachments/gallery.mjs";
import {
  PostgresAttachmentRepository,
} from "../../../apps/api/src/modules/attachments/postgres-repository.mjs";
import {
  ExpenseService,
} from "../../../apps/api/src/modules/expenses/index.mjs";
import {
  PostgresExpenseRepository,
} from "../../../apps/api/src/modules/expenses/postgres-repository.mjs";

const databaseUrl = process.env.OTR_M3_DATABASE_URL;
const liveTest = databaseUrl ? test : test.skip;
const ownerId = "m3-int-workspace";
let database: PostgresExecutor | undefined;
let routeProcessor: PostgresRouteRebuildProcessor | undefined;

afterEach(async () => {
  await routeProcessor?.close();
  routeProcessor = undefined;
  if (database) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await database.query("DELETE FROM trip WHERE owner_id = $1", [ownerId]);
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
      }
    }
    await database.close();
    database = undefined;
  }
});

describe("TC-M3-INT-01 Route/gallery/cost workspace", () => {
  liveTest("persists route rebuilds, gallery edits and five-dimension costs", async () => {
    database = new PostgresExecutor({ databaseUrl, role: "test" });
    routeProcessor = new PostgresRouteRebuildProcessor(databaseUrl!);
    const context = await seedWorkspace(database);

    await expect(
      routeProcessor.process(await latestRouteEvent(database, context.dayIds[0])),
    ).resolves.toHaveProperty("applied");
    const initialRoutes = await activeRoutes(database, context.tripId);
    expect(initialRoutes).toMatchObject([
      {
        from_target: "A",
        to_target: "B",
        status: "resolved",
        transport_mode_code: "WALK",
      },
      {
        from_target: "B",
        to_target: "C",
        status: "resolved",
        transport_mode_code: "FERRY",
      },
      {
        from_target: "C",
        to_target: "Missing location",
        status: "pending",
      },
    ]);
    expect(initialRoutes[1]?.trip_day_id).toBe(context.dayIds[1]);

    const dayVersion = (await database.query<{ version: number }>(
      "SELECT version FROM trip_day WHERE id = $1::uuid",
      [context.dayIds[0]],
    )).rows[0]!.version;
    await database.query(
      "SELECT reorder_itinerary_items($1, $2::uuid, $3::uuid, $4, $5::jsonb)",
      [
        ownerId,
        context.tripId,
        context.dayIds[0],
        dayVersion,
        JSON.stringify([context.itemIds[1], context.itemIds[0]]),
      ],
    );
    expect(await activeRoutes(database, context.tripId)).toMatchObject([
      {
        from_target: "C",
        to_target: "Missing location",
        status: "pending",
      },
    ]);
    await expect(
      routeProcessor.process(await latestRouteEvent(database, context.dayIds[0])),
    ).resolves.toHaveProperty("applied");
    expect((await activeRoutes(database, context.tripId))[0]).toMatchObject({
      from_target: "B",
      to_target: "A",
      status: "resolved",
    });

    const gallery = new AttachmentGalleryService(
      new PostgresAttachmentRepository({ executor: database }),
    );
    await seedReadyGallery(database, context.tripId, context.itemIds[0]);
    const [photoA, photoB] = await gallery.list(ownerId, context.itemIds[0]);
    const updated = await gallery.update(ownerId, photoB.id, photoB.version, {
      caption: "Night view",
      isCover: true,
    });
    expect(updated).toMatchObject({ caption: "Night view", isCover: true });
    const reordered = await gallery.reorder(
      ownerId,
      context.itemIds[0],
      { [photoA.id]: photoA.version + 1, [photoB.id]: updated.version },
      [photoB.id, photoA.id],
    );
    expect(reordered.map(({ id }) => id)).toEqual([photoB.id, photoA.id]);
    await gallery.remove(ownerId, photoA.id);
    await expect(gallery.list(ownerId, context.itemIds[0])).resolves.toMatchObject([
      { id: photoB.id, caption: "Night view", isCover: true },
    ]);

    const expenses = new ExpenseService(
      new PostgresExpenseRepository({ executor: database }),
    );
    await expenses.create(ownerId, context.tripId, {
      itineraryItemId: context.itemIds[0],
      destinationId: context.destinationId,
      amount: "80",
      currency: "CNY",
      categoryCode: "DINING",
      transportModeCode: "WALK",
    });
    await expenses.setRate(ownerId, context.tripId, {
      fromCurrency: "USD",
      toCurrency: "CNY",
      rate: "7",
    });
    await expenses.create(ownerId, context.tripId, {
      itineraryItemId: context.itemIds[2],
      destinationId: context.destinationId,
      amount: "10",
      currency: "USD",
      categoryCode: "TRANSPORT",
      transportModeCode: "FERRY",
    });
    const summary = await expenses.summary(ownerId, context.tripId);
    expect(summary.settledActualTotal).toBe("150.0000");
    expect(summary.breakdowns.day[context.dayIds[0]]?.settledTotal).toBe("80.0000");
    expect(summary.breakdowns.day[context.dayIds[1]]?.settledTotal).toBe("70.0000");
    expect(summary.breakdowns.destination[context.destinationId]?.settledTotal)
      .toBe("150.0000");
    expect(summary.breakdowns.category.DINING?.settledTotal).toBe("80.0000");
    expect(summary.breakdowns.mode.FERRY?.settledTotal).toBe("70.0000");
    expect(summary.originalCurrencyTotals).toEqual({
      CNY: "80.0000",
      USD: "10.0000",
    });
  });
});

async function seedWorkspace(db: PostgresExecutor) {
  const tripId = randomUUID();
  const destinationId = randomUUID();
  const locationIds = [randomUUID(), randomUUID(), randomUUID()];
  const itemIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await db.query(
    `INSERT INTO trip (
       id, owner_id, name, start_date, end_date, default_currency, timezone
     ) VALUES (
       $1::uuid, $2, 'M3 workspace', '2026-10-01', '2026-10-02',
       'CNY', 'Asia/Shanghai'
     )`,
    [tripId, ownerId],
  );
  await db.query(
    `INSERT INTO destination (id, trip_id, name, sort_order)
     VALUES ($1::uuid, $2::uuid, 'Shanghai', 0)`,
    [destinationId, tripId],
  );
  const dayIds = (await db.query<{ id: string }>(
    "SELECT id FROM trip_day WHERE trip_id = $1::uuid ORDER BY day_number",
    [tripId],
  )).rows.map(({ id }) => id);
  for (const [index, locationId] of locationIds.entries()) {
    await db.query(
      `INSERT INTO location (
         id, trip_id, owner_id, input_text, name, geom,
         provider, source_crs, geocoding_status
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4, $4,
         ST_SetSRID(ST_MakePoint($5, $6), 4326),
         'fixture', 'EPSG:4326', 'resolved'
       )`,
      [
        locationId,
        tripId,
        ownerId,
        ["A", "B", "C"][index],
        121.47 + index * 0.02,
        31.23 + index * 0.01,
      ],
    );
  }
  const rows = [
    [itemIds[0], dayIds[0], "A", locationIds[0], 1024, null],
    [itemIds[1], dayIds[0], "B", locationIds[1], 2048, "WALK"],
    [itemIds[2], dayIds[1], "C", locationIds[2], 1024, "FERRY"],
    [itemIds[3], dayIds[1], "Missing location", null, 2048, null],
  ];
  for (const row of rows) {
    await db.query(
      `INSERT INTO itinerary_item (
         id, trip_id, owner_id, trip_day_id, item_type, time_kind,
         target, location_id, sort_order, transport_mode_code
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4::uuid, 'attraction', 'unscheduled',
         $5, $6::uuid, $7, $8
       )`,
      [row[0], tripId, ownerId, ...row.slice(1)],
    );
  }
  return { tripId, destinationId, dayIds, locationIds, itemIds };
}

async function seedReadyGallery(
  db: PostgresExecutor,
  tripId: string,
  itemId: string,
) {
  const checksum = `${"A".repeat(43)}=`;
  for (const [index, id] of [randomUUID(), randomUUID()].entries()) {
    await db.query(
      `INSERT INTO attachment (
         id, trip_id, owner_id, itinerary_item_id, object_key,
         expected_content_type, expected_content_length,
         expected_checksum_sha256, expires_at, status,
         object_version, checksum_sha256, content_type, content_length, etag,
         width, height, thumbnail_key, thumbnail_version,
         thumbnail_checksum_sha256, thumbnail_content_type,
         thumbnail_content_length, completed_at, sort_order, caption, is_cover
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4::uuid, $5,
         'image/png', 68, $6, now() + interval '1 hour', 'ready',
         'v1', $6, 'image/png', 68, 'etag',
         1, 1, $7, 'thumb-v1', $6, 'image/png', 68, now(),
         $8, $9, $10
       )`,
      [
        id,
        tripId,
        ownerId,
        itemId,
        `attachments/${"a".repeat(32)}/${id.replaceAll("-", "")}`,
        checksum,
        `derived/${id}/thumbnail`,
        index,
        index === 0 ? "Arrival" : "Street",
        index === 0,
      ],
    );
  }
}

async function latestRouteEvent(
  db: PostgresExecutor,
  dayId: string,
): Promise<JobEvent> {
  const row = (await db.query<{
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
     WHERE event_type = 'route.rebuild.requested' AND aggregate_id = $1
     ORDER BY created_at DESC, event_id DESC
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

async function activeRoutes(db: PostgresExecutor, tripId: string) {
  return (await db.query<{
    trip_day_id: string;
    from_target: string;
    to_target: string;
    status: string;
    transport_mode_code: string;
  }>(
    `SELECT route.trip_day_id, source.target AS from_target,
            destination.target AS to_target, route.status,
            route.transport_mode_code
     FROM route_segment route
     JOIN itinerary_item source ON source.id = route.from_itinerary_item_id
     JOIN itinerary_item destination ON destination.id = route.to_itinerary_item_id
     JOIN trip_day source_day ON source_day.id = source.trip_day_id
     WHERE route.trip_id = $1::uuid AND route.status <> 'obsolete'
     ORDER BY source_day.day_number, source.sort_order, route.id`,
    [tripId],
  )).rows;
}
