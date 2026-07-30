import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  ExpenseService,
  InMemoryExpenseRepository,
  PostgresExpenseRepository,
} from "../../src/modules/expenses/index.mjs";
import {
  cleanOwner,
  expenseDatabaseUrl,
  prepareExpenseDatabase,
  psql,
} from "./postgres-harness.mjs";

describe("TC-D04-02 missing rate and ownership invariants", () => {
  test("keeps missing-rate amounts unconverted and rejects invalid references", async () => {
    const repository = new InMemoryExpenseRepository({
      trips: [
        { id: "trip-a", ownerId: "owner-a", defaultCurrency: "CNY" },
        { id: "trip-b", ownerId: "owner-b", defaultCurrency: "USD" },
      ],
      items: [
        { id: "item-a", tripId: "trip-a", ownerId: "owner-a", tripDayId: "day-a" },
        { id: "item-b", tripId: "trip-b", ownerId: "owner-b", tripDayId: "day-b" },
      ],
    });
    const service = new ExpenseService(repository);

    await expect(service.create("owner-a", "trip-a", {
      itineraryItemId: "item-a",
      amount: "25.00",
      currency: "USD",
      categoryCode: "DINING",
    })).resolves.toMatchObject({
      originalAmount: "25.0000",
      currency: "USD",
      settlementCurrency: "CNY",
      exchangeRate: null,
      settledAmount: null,
    });
    await expect(service.create("owner-a", "trip-a", {
      itineraryItemId: "item-b",
      amount: "25",
      currency: "CNY",
      categoryCode: "DINING",
    })).rejects.toMatchObject({ code: "EXPENSE_REFERENCE_MISMATCH" });
    await expect(service.create("owner-a", "trip-a", {
      amount: "-1",
      currency: "CNY",
      categoryCode: "DINING",
    })).rejects.toMatchObject({ code: "EXPENSE_INVALID" });
    await expect(service.create("owner-a", "trip-a", {
      amount: "1",
      currency: "ZZZ",
      categoryCode: "DINING",
    })).rejects.toMatchObject({ code: "EXPENSE_CURRENCY_UNSUPPORTED" });
  });
});

const liveTest = expenseDatabaseUrl ? test : test.skip;
const ownerId = `tc-d04-${randomUUID()}`;
let tripId: string;
let itemId: string;
let foreignItemId: string;

describe("TC-D04-02 PostgreSQL ownership and decimal constraints", () => {
  beforeAll(async () => {
    if (!expenseDatabaseUrl) return;
    await prepareExpenseDatabase();
    tripId = await createTrip(ownerId, "D04 owner trip");
    const foreignTripId = await createTrip(`${ownerId}-foreign`, "D04 foreign trip");
    itemId = await createItem(tripId, ownerId, "Owned item");
    foreignItemId = await createItem(
      foreignTripId,
      `${ownerId}-foreign`,
      "Foreign item",
    );
  });

  afterAll(async () => {
    await cleanOwner(ownerId);
    await cleanOwner(`${ownerId}-foreign`);
  });

  liveTest("persists amount strings and rejects cross-Trip references", async () => {
    const service = new ExpenseService(
      new PostgresExpenseRepository({ databaseUrl: expenseDatabaseUrl }),
    );
    await expect(service.create(ownerId, tripId, {
      itineraryItemId: itemId,
      amount: "0.1001",
      currency: "USD",
      categoryCode: "DINING",
    })).resolves.toMatchObject({
      originalAmount: "0.1001",
      currency: "USD",
      exchangeRate: null,
      settledAmount: null,
    });
    await expect(service.create(ownerId, tripId, {
      itineraryItemId: foreignItemId,
      amount: "1",
      currency: "CNY",
      categoryCode: "DINING",
    })).rejects.toMatchObject({ code: "EXPENSE_REFERENCE_MISMATCH" });
    await expect(psql(
      `UPDATE expense SET original_amount = -1 WHERE trip_id = '${tripId}'`,
    )).rejects.toThrow();
  });
});

async function createTrip(owner: string, name: string): Promise<string> {
  return psql(`INSERT INTO trip (
    owner_id, name, start_date, end_date, travelers,
    default_currency, timezone, map_profile
  )
  VALUES (
    '${owner}', '${name}', '2027-06-01', '2027-06-01',
    1, 'CNY', 'Asia/Shanghai', 'cn_primary'
  )
  RETURNING id`);
}

async function createItem(
  ownerTripId: string,
  owner: string,
  target: string,
): Promise<string> {
  const dayId = await psql(
    `SELECT id FROM trip_day WHERE trip_id = '${ownerTripId}' LIMIT 1`,
  );
  return psql(`INSERT INTO itinerary_item (
    trip_id, owner_id, trip_day_id, target, sort_order
  )
  VALUES (
    '${ownerTripId}', '${owner}', '${dayId}', '${target}', 0
  )
  RETURNING id`);
}
