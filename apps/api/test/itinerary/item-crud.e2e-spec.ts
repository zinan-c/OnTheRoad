import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { parseItineraryItemResponse } from "../../../../packages/contracts/src/generated/index.mjs";
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
const ownerId = `tc-b05-crud-${randomUUID()}`;
const encryptionKey = {
  id: "b05-test-v1",
  secret: "tc-b05-encryption-secret-at-least-32-bytes",
};
let service: ItineraryService;
let tripId: string;
let dayId: string;
let locationId: string;
let destinationId: string;

describe("TC-B05-01 Full-field persistence", () => {
  beforeAll(async () => {
    if (!itineraryDatabaseUrl) return;
    await prepareItineraryDatabase();
    tripId = await psql(`INSERT INTO trip (
      owner_id, name, start_date, end_date, travelers,
      default_currency, timezone, map_profile
    )
    VALUES (
      '${ownerId}', 'B05 full fields', '2027-04-01', '2027-04-03',
      2, 'CNY', 'Asia/Shanghai', 'cn_primary'
    )
    RETURNING id`);
    await psql(
      `SELECT insert_trip_date_days(
        '${tripId}', '2027-04-01', '2027-04-03'
      )`,
    );
    dayId = await psql(
      `SELECT id FROM trip_day
       WHERE trip_id = '${tripId}'
       ORDER BY day_number
       LIMIT 1`,
    );
    destinationId = await psql(`INSERT INTO destination (
      trip_id, name, sort_order
    )
    VALUES ('${tripId}', '上海', 0)
    RETURNING id`);
    locationId = await psql(`INSERT INTO location (
      trip_id, owner_id, input_text, name
    )
    VALUES ('${tripId}', '${ownerId}', '外滩', '外滩')
    RETURNING id`);
    if (!dayId) throw new Error("B05 fixture failed to create a TripDay");
    service = new ItineraryService(
      new PostgresItineraryRepository({ databaseUrl: itineraryDatabaseUrl }),
      new ItineraryCipher({ activeKey: encryptionKey }),
    );
  });

  afterAll(async () => {
    await cleanOwner(ownerId);
  });

  liveTest("round-trips every item type and all itinerary, dining, and accommodation fields", async () => {
    const common = {
      tripDayId: dayId,
      timeZone: "Asia/Shanghai",
      destinationId,
      locationId,
      bookingInfo: { reference: "CN-2027-04", provider: "official" },
      contactInfo: { name: "前台", phone: "+86 21 0000 0000" },
      remark: "靠窗",
      externalSource: "b05-test",
    };
    const inputs = [
      {
        ...common,
        itemType: "activity",
        timeKind: "clock",
        startTime: "09:00",
        target: "晨间散步",
        description: "沿江",
        durationMinutes: 60,
        externalId: "activity-1",
      },
      {
        ...common,
        itemType: "attraction",
        timeKind: "period",
        timePeriod: "morning",
        target: "东方明珠",
        externalId: "attraction-1",
      },
      {
        ...common,
        itemType: "dining",
        timeKind: "range",
        startTime: "12:00",
        endTime: "13:15",
        target: "午餐",
        dining: {
          name: "南翔馒头店",
          mealType: "lunch",
          details: "两人套餐",
          locationId,
        },
        externalId: "dining-1",
      },
      {
        ...common,
        itemType: "hotel",
        timeKind: "range",
        startTime: "22:30",
        endTime: "07:30",
        endDayOffset: 1,
        target: "入住酒店",
        accommodation: {
          name: "山间酒店",
          details: "大床房",
          locationId,
          checkInAt: "2027-04-01T14:30:00.000Z",
          checkOutAt: "2027-04-02T00:30:00.000Z",
          bookingInfo: { reference: "HOTEL-1" },
          contactInfo: { name: "礼宾部", phone: "+86 21 1111 2222" },
        },
        externalId: "hotel-1",
      },
      {
        ...common,
        itemType: "transport",
        timeKind: "range",
        startTime: "14:00",
        endTime: "15:00",
        target: "前往机场",
        startLocationId: locationId,
        endLocationId: locationId,
        transportModeCode: "METRO",
        externalId: "transport-1",
      },
      {
        ...common,
        itemType: "other",
        timeKind: "unscheduled",
        target: "自由安排",
        externalId: "other-1",
      },
    ];

    const created = [];
    for (const input of inputs) {
      created.push(await service.create(ownerId, tripId, input));
    }

    expect(created.map((item) => item.itemType)).toEqual([
      "activity",
      "attraction",
      "dining",
      "hotel",
      "transport",
      "other",
    ]);
    expect(created[2]).toMatchObject({
      dining: {
        name: "南翔馒头店",
        mealType: "lunch",
        details: "两人套餐",
        locationId,
      },
      bookingInfo: common.bookingInfo,
      contactInfo: common.contactInfo,
    });
    expect(created[3]).toMatchObject({
      endDayOffset: 1,
      accommodation: {
        name: "山间酒店",
        details: "大床房",
        locationId,
        bookingInfo: { reference: "HOTEL-1" },
        contactInfo: { name: "礼宾部", phone: "+86 21 1111 2222" },
      },
    });
    expect(created[4]).toMatchObject({
      startLocationId: locationId,
      endLocationId: locationId,
      transportModeCode: "METRO",
    });
    expect(created.map(parseItineraryItemResponse)).toEqual(created);
    expect(await service.listDay(ownerId, tripId, dayId)).toEqual(created);

    const rawSensitive = await psql(
      `SELECT concat_ws(
        '|',
        encode(booking_info_ciphertext, 'escape'),
        encode(contact_info_ciphertext, 'escape')
      )
      FROM itinerary_item
      WHERE id = '${created[0].id}'`,
    );
    expect(rawSensitive).not.toContain("CN-2027-04");
    expect(rawSensitive).not.toContain("0000 0000");
  });
});
