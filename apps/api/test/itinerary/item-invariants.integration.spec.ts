import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  ItineraryCipher,
  ItineraryService,
  PostgresItineraryRepository,
} from "../../src/modules/itinerary/index.mjs";
import {
  cleanOwner,
  itineraryDatabaseUrl,
  prepareItineraryDatabase,
  psql,
} from "./postgres-harness.mjs";

const liveTest = itineraryDatabaseUrl ? test : test.skip;
const ownerA = `tc-b05-owner-a-${randomUUID()}`;
const ownerB = `tc-b05-owner-b-${randomUUID()}`;
let service: ItineraryService;
let tripA = randomUUID();
let tripB = randomUUID();
let dayA = randomUUID();
let dayB = randomUUID();
let locationB = randomUUID();

function baseInput(overrides = {}) {
  return {
    tripDayId: dayA,
    itemType: "activity",
    timeKind: "range",
    startTime: "10:00",
    endTime: "11:00",
    target: "合法项目",
    ...overrides,
  };
}

describe("TC-B05-02 Time, ownership, and delete invariants", () => {
  test("domain rejects empty content and invalid same-day/cross-midnight combinations", () => {
    const cipher = new ItineraryCipher({
      activeKey: {
        id: "b05-test-v1",
        secret: "tc-b05-encryption-secret-at-least-32-bytes",
      },
    });
    const unitService = new ItineraryService({}, cipher);
    expect(() => unitService.normalizeCreate(baseInput({ target: "", description: "" })))
      .toThrow(/target|description/u);
    expect(() => unitService.normalizeCreate(baseInput({ startTime: "12:00", endTime: "11:00" })))
      .toThrow(/endTime/u);
    expect(() => unitService.normalizeCreate(baseInput({
      timeKind: "clock",
      startTime: "23:00",
      endTime: undefined,
      endDayOffset: 1,
    }))).toThrow(/endDayOffset/u);
  });

  beforeAll(async () => {
    if (!itineraryDatabaseUrl) return;
    await prepareItineraryDatabase();
    tripA = await psql(`INSERT INTO trip (
      owner_id, name, start_date, end_date, travelers,
      default_currency, timezone, map_profile
    ) VALUES (
      '${ownerA}', 'A', '2027-05-01', '2027-05-02',
      1, 'CNY', 'UTC', 'international_primary'
    ) RETURNING id`);
    tripB = await psql(`INSERT INTO trip (
      owner_id, name, start_date, end_date, travelers,
      default_currency, timezone, map_profile
    ) VALUES (
      '${ownerB}', 'B', '2027-05-01', '2027-05-02',
      1, 'CNY', 'UTC', 'international_primary'
    ) RETURNING id`);
    await psql(
      `SELECT insert_trip_date_days(
        '${tripA}', '2027-05-01', '2027-05-02'
      )`,
    );
    await psql(
      `SELECT insert_trip_date_days(
        '${tripB}', '2027-05-01', '2027-05-02'
      )`,
    );
    dayA = await psql(
      `SELECT id FROM trip_day
       WHERE trip_id = '${tripA}'
       ORDER BY day_number
       LIMIT 1`,
    );
    dayB = await psql(
      `SELECT id FROM trip_day
       WHERE trip_id = '${tripB}'
       ORDER BY day_number
       LIMIT 1`,
    );
    locationB = await psql(`INSERT INTO location (
      trip_id, owner_id, input_text, name
    )
    VALUES ('${tripB}', '${ownerB}', 'B location', 'B location')
    RETURNING id`);
    if (!dayA || !dayB) {
      throw new Error("B05 fixture failed to create owner-scoped TripDays");
    }
    service = new ItineraryService(
      new PostgresItineraryRepository({ databaseUrl: itineraryDatabaseUrl }),
      new ItineraryCipher({
        activeKey: {
          id: "b05-test-v1",
          secret: "tc-b05-encryption-secret-at-least-32-bytes",
        },
      }),
    );
  });

  afterAll(async () => {
    await cleanOwner(ownerA);
    await cleanOwner(ownerB);
  });

  liveTest("rejects cross-trip day/location references and owner access", async () => {
    await expect(service.create(ownerA, tripA, baseInput({ tripDayId: dayB })))
      .rejects.toMatchObject({ code: "ITINERARY_REFERENCE_MISMATCH" });
    await expect(service.create(ownerA, tripA, baseInput({ locationId: locationB })))
      .rejects.toMatchObject({ code: "ITINERARY_REFERENCE_MISMATCH" });

    const item = await service.create(ownerA, tripA, baseInput());
    await expect(service.get(ownerB, tripA, item.id))
      .rejects.toMatchObject({ code: "ITINERARY_NOT_FOUND", status: 404 });
  });

  liveTest("soft delete rejects later updates and retains associated historical rows", async () => {
    const created = await service.create(ownerA, tripA, baseInput({
      itemType: "dining",
      target: "保留历史",
      dining: { name: "历史餐厅", mealType: "dinner" },
    }));
    const deleted = await service.delete(ownerA, tripA, created.id, {
      expectedVersion: created.version,
    });
    expect(deleted).toMatchObject({ deletedAt: expect.any(String), version: 2 });
    await expect(
      service.update(ownerA, tripA, created.id, { remark: "不得更新" }, {
        expectedVersion: deleted.version,
      }),
    ).rejects.toMatchObject({ code: "ITINERARY_NOT_FOUND" });
    expect(await psql(
      `SELECT count(*) FROM dining_item WHERE itinerary_item_id = '${created.id}'`,
    )).toBe("1");
    await expect(service.get(ownerA, tripA, created.id))
      .rejects.toMatchObject({ code: "ITINERARY_NOT_FOUND" });
    expect(await service.get(ownerA, tripA, created.id, { includeDeleted: true }))
      .toEqual(deleted);
  });
});
