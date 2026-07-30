import { describe, expect, test } from "vitest";

import {
  ExpenseService,
  InMemoryExpenseRepository,
} from "../../src/modules/expenses/index.mjs";

describe("TC-D04-03 expense summary seed", () => {
  test("retains original CNY/USD and explains the rate snapshot without route cost", async () => {
    const repository = new InMemoryExpenseRepository({
      trips: [{ id: "trip-a", ownerId: "owner-a", defaultCurrency: "CNY" }],
      items: [
        { id: "item-a", tripId: "trip-a", ownerId: "owner-a", tripDayId: "day-a" },
      ],
    });
    const service = new ExpenseService(repository);
    await service.setRate("owner-a", "trip-a", {
      fromCurrency: "USD",
      toCurrency: "CNY",
      rate: "7.200000000000",
    });
    await service.create("owner-a", "trip-a", {
      itineraryItemId: "item-a",
      amount: "100",
      currency: "CNY",
      categoryCode: "DINING",
    });
    await service.create("owner-a", "trip-a", {
      itineraryItemId: "item-a",
      amount: "10",
      currency: "USD",
      categoryCode: "TICKET",
    });
    await service.create("owner-a", "trip-a", {
      itineraryItemId: "item-a",
      amount: "999",
      currency: "CNY",
      categoryCode: "TRANSPORT",
      source: "route_estimate",
    });

    expect(await service.summary("owner-a", "trip-a")).toEqual({
      settlementCurrency: "CNY",
      settledActualTotal: "172.0000",
      originalCurrencyTotals: {
        CNY: "100.0000",
        USD: "10.0000",
      },
      unconverted: [],
      rateSnapshots: [{
        fromCurrency: "USD",
        toCurrency: "CNY",
        rate: "7.200000000000",
      }],
    });
  });
});
