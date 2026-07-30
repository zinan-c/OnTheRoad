import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  ItineraryCipher,
  ItineraryService,
  PostgresItineraryRepository,
} from "../../apps/api/src/modules/itinerary/index.mjs";
import {
  cleanOwner,
  itineraryDatabaseUrl,
  prepareItineraryDatabase,
  psql,
} from "../../apps/api/test/itinerary/postgres-harness.mjs";

const liveTest = itineraryDatabaseUrl ? test : test.skip;
const ownerId = `tc-b05-lifecycle-${randomUUID()}`;
const cipherOptions = {
  activeKey: {
    id: "b05-lifecycle-v1",
    secret: "tc-b05-lifecycle-secret-at-least-32-bytes",
  },
};
let tripId: string;
let firstDayId: string;
let secondDayId: string;

function restartedService() {
  return new ItineraryService(
    new PostgresItineraryRepository({ databaseUrl: itineraryDatabaseUrl }),
    new ItineraryCipher(cipherOptions),
  );
}

describe("TC-B05-03 Copy and reload lifecycle", () => {
  beforeAll(async () => {
    if (!itineraryDatabaseUrl) return;
    await prepareItineraryDatabase();
    tripId = await psql(`INSERT INTO trip (
      owner_id, name, start_date, end_date, travelers,
      default_currency, timezone, map_profile
    )
    VALUES (
      '${ownerId}', 'B05 lifecycle', '2027-06-01', '2027-06-02',
      1, 'CNY', 'Asia/Shanghai', 'cn_primary'
    )
    RETURNING id`);
    await psql(
      `SELECT insert_trip_date_days(
        '${tripId}', '2027-06-01', '2027-06-02'
      )`,
    );
    const dayIds = (
      await psql(
        `SELECT id FROM trip_day
         WHERE trip_id = '${tripId}'
         ORDER BY day_number`,
      )
    ).split("\n");
    [firstDayId, secondDayId] = dayIds;
    if (!firstDayId || !secondDayId) {
      throw new Error("B05 fixture failed to create both lifecycle TripDays");
    }
  });

  afterAll(async () => {
    await cleanOwner(ownerId);
  });

  liveTest("creates, copies to another day, updates, soft-deletes, and reloads stable facts", async () => {
    const firstProcess = restartedService();
    const created = await firstProcess.create(ownerId, tripId, {
      tripDayId: firstDayId,
      itemType: "dining",
      timeKind: "range",
      startTime: "18:00",
      endTime: "19:30",
      target: "晚餐",
      bookingInfo: { reference: "DINNER-ORIGINAL" },
      contactInfo: { phone: "+86 21 9999 8888" },
      dining: { name: "江景餐厅", mealType: "dinner" },
    });
    const copied = await firstProcess.copy(
      ownerId,
      tripId,
      created.id,
      secondDayId,
    );
    expect(copied).toMatchObject({
      tripDayId: secondDayId,
      itemType: "dining",
      version: 1,
      bookingInfo: { reference: "DINNER-ORIGINAL" },
      contactInfo: { phone: "+86 21 9999 8888" },
    });
    expect(copied.id).not.toBe(created.id);
    expect(copied.externalSource).toBeNull();
    expect(copied.externalId).toBeNull();

    const updated = await firstProcess.update(
      ownerId,
      tripId,
      copied.id,
      {
        target: "第二天晚餐",
        remark: "复制后修改",
        bookingInfo: { reference: "DINNER-COPY" },
      },
      { expectedVersion: copied.version },
    );
    expect(updated).toMatchObject({
      id: copied.id,
      target: "第二天晚餐",
      version: 2,
      bookingInfo: { reference: "DINNER-COPY" },
    });

    const deleted = await firstProcess.delete(
      ownerId,
      tripId,
      created.id,
      { expectedVersion: created.version },
    );
    expect(deleted).toMatchObject({
      id: created.id,
      version: 2,
      deletedAt: expect.any(String),
    });

    const secondProcess = restartedService();
    expect(await secondProcess.listDay(ownerId, tripId, firstDayId)).toEqual([]);
    expect(await secondProcess.listDay(ownerId, tripId, secondDayId)).toEqual([
      updated,
    ]);
    expect(await secondProcess.get(ownerId, tripId, copied.id)).toEqual(updated);
    expect(
      await secondProcess.get(ownerId, tripId, created.id, {
        includeDeleted: true,
      }),
    ).toEqual(deleted);
    expect(await psql(
      `SELECT jsonb_agg(action ORDER BY audit_id)::text
       FROM itinerary_item_audit
       WHERE itinerary_item_id IN ('${created.id}', '${copied.id}')`,
    )).toBe(
      '["itinerary.created", "itinerary.copied", "itinerary.updated", "itinerary.deleted"]',
    );
  });
});
