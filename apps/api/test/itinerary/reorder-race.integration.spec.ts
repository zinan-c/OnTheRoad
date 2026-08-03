import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  ItineraryCipher,
  ItineraryService,
  PostgresItineraryRepository,
} from "../../src/modules/itinerary/index.mjs";
import {
  ItineraryOrderService,
  PostgresItineraryOrderRepository,
} from "../../src/modules/itinerary/reorder.mjs";
import {
  applyMigration,
  cleanOwner,
  itineraryDatabaseUrl,
  prepareItineraryDatabase,
  psql,
} from "./postgres-harness.mjs";

const liveTest = itineraryDatabaseUrl ? test : test.skip;
const ownerId = `tc-b07-race-${randomUUID()}`;
let tripId: string;
let dayId: string;
let itemIds: string[];
let orderService: ItineraryOrderService;
let initialDayState: { version: number; routeGeneration: number };

describe("TC-B07-02 Concurrent reorder barrier", () => {
  beforeAll(async () => {
    if (!itineraryDatabaseUrl) return;
    await prepareItineraryDatabase();
    const managedSchema = Boolean(
      await psql("SELECT to_regclass('public.otr_schema_migration')"),
    );
    if (!(await psql("SELECT to_regclass('public.job_outbox')"))) {
      await applyMigration("packages/database/src/migrations/0001_jobs.sql");
    }
    if (
      !managedSchema
      &&
      !(await psql(
        "SELECT to_regprocedure('reorder_itinerary_items(text,uuid,uuid,integer,jsonb)')",
      ))
    ) {
      await applyMigration(
        "packages/database/src/migrations/0010_itinerary_reorder.sql",
      );
    }
    tripId = await psql(`INSERT INTO trip (
      owner_id, name, start_date, end_date, travelers,
      default_currency, timezone, map_profile
    ) VALUES (
      '${ownerId}', 'B07 race', '2027-07-01', '2027-07-01',
      1, 'CNY', 'UTC', 'international_primary'
    ) RETURNING id`);
    await psql(
      `SELECT insert_trip_date_days(
        '${tripId}', '2027-07-01', '2027-07-01'
      )`,
    );
    dayId = await psql(
      `SELECT id FROM trip_day WHERE trip_id = '${tripId}'`,
    );
    if (!dayId) throw new Error("B07 fixture failed to create TripDay");
    const itemService = new ItineraryService(
      new PostgresItineraryRepository({ databaseUrl: itineraryDatabaseUrl }),
      new ItineraryCipher({
        activeKey: {
          id: "b07-test-v1",
          secret: "tc-b07-encryption-secret-at-least-32-bytes",
        },
      }),
    );
    const items = [];
    for (const target of ["A", "B", "C"]) {
      items.push(await itemService.create(ownerId, tripId, {
        tripDayId: dayId,
        itemType: "activity",
        timeKind: "unscheduled",
        target,
      }));
    }
    itemIds = items.map(({ id }) => id);
    initialDayState = JSON.parse(await psql(`SELECT jsonb_build_object(
      'version', version,
      'routeGeneration', route_generation
    )::text FROM trip_day WHERE id = '${dayId}'`));
    orderService = new ItineraryOrderService(
      new PostgresItineraryOrderRepository({
        databaseUrl: itineraryDatabaseUrl,
      }),
    );
  });

  afterAll(async () => {
    await cleanOwner(ownerId);
  });

  liveTest("allows one baseVersion winner, rejects the stale client, and commits no partial order", async () => {
    const orders = [
      [itemIds[2]!, itemIds[0]!, itemIds[1]!],
      [itemIds[1]!, itemIds[2]!, itemIds[0]!],
    ];
    const results = await Promise.allSettled(
      orders.map((orderedIds) =>
        orderService.reorder(ownerId, tripId, dayId, {
          baseVersion: 1,
          orderedIds,
        })
      ),
    );
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      reason: {
        code: "ITINERARY_ORDER_VERSION_CONFLICT",
        status: 409,
      },
    });

    const persisted = JSON.parse(
      await psql(`SELECT jsonb_build_object(
        'version', day.version,
        'routeGeneration', day.route_generation,
        'orderedIds', (
          SELECT jsonb_agg(item.id ORDER BY item.sort_order)
          FROM itinerary_item item
          WHERE item.trip_day_id = day.id AND item.deleted_at IS NULL
        ),
        'sortOrders', (
          SELECT jsonb_agg(item.sort_order ORDER BY item.sort_order)
          FROM itinerary_item item
          WHERE item.trip_day_id = day.id AND item.deleted_at IS NULL
        ),
        'events', (
          SELECT count(*) FROM job_outbox event
          WHERE event.event_type = 'itinerary.order.changed'
            AND event.aggregate_id = day.id::text
        )
      )::text
      FROM trip_day day
      WHERE day.id = '${dayId}'`),
    );
    expect(orders).toContainEqual(persisted.orderedIds);
    expect(persisted).toMatchObject({
      version: initialDayState.version + 1,
      routeGeneration: initialDayState.routeGeneration + 1,
      sortOrders: [1024, 2048, 3072],
      events: 1,
    });
  });
});
