import { describe, expect, test } from "vitest";

import {
  ExpenseService,
  InMemoryExpenseRepository,
} from "../../src/modules/expenses/index.mjs";

describe("TC-D04-03 expense summary seed", () => {
  test("E2E-019 snapshots a newly saved rate onto previously unconverted expenses", async () => {
    const repository = new InMemoryExpenseRepository({
      trips: [{ id: "trip-rate", ownerId: "owner-rate", defaultCurrency: "CNY" }],
      items: [{ id: "item-rate", tripId: "trip-rate", ownerId: "owner-rate", tripDayId: "day-rate" }],
    });
    const service = new ExpenseService(repository);
    const pending = await service.create("owner-rate", "trip-rate", {
      itineraryItemId: "item-rate",
      amount: "50.25",
      currency: "USD",
      categoryCode: "TRANSPORT",
    });
    expect(pending).toMatchObject({ settledAmount: null, exchangeRate: null, version: 1 });

    const saved = await service.setRate("owner-rate", "trip-rate", {
      fromCurrency: "USD",
      toCurrency: "CNY",
      rate: "7.2000",
    });
    expect(saved.reconciledExpenseIds).toEqual([pending.id]);
    expect(await service.listRates("owner-rate", "trip-rate")).toHaveLength(1);
    expect(await service.listForItem("owner-rate", "trip-rate", "item-rate")).toEqual([
      expect.objectContaining({
        exchangeRate: "7.200000000000",
        settledAmount: "361.8000",
        version: 2,
      }),
    ]);
  });

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
      breakdowns: {
        category: {
          DINING: {
            originalTotal: "100.0000",
            settledTotal: "100.0000",
            unconverted: "0",
          },
          TICKET: {
            originalTotal: "10.0000",
            settledTotal: "72.0000",
            unconverted: "0",
          },
        },
        currency: {
          CNY: {
            originalTotal: "100.0000",
            settledTotal: "100.0000",
            unconverted: "0",
          },
          USD: {
            originalTotal: "10.0000",
            settledTotal: "72.0000",
            unconverted: "0",
          },
        },
        day: {
          "day-a": {
            originalTotal: "110.0000",
            settledTotal: "172.0000",
            unconverted: "0",
          },
        },
        destination: {
          unassigned: {
            originalTotal: "110.0000",
            settledTotal: "172.0000",
            unconverted: "0",
          },
        },
        mode: {
          unassigned: {
            originalTotal: "110.0000",
            settledTotal: "172.0000",
            unconverted: "0",
          },
        },
      },
    });
  });

  test("always reports actual expenses in CNY when the Trip default currency differs", async () => {
    const repository = new InMemoryExpenseRepository({
      trips: [{ id: "trip-eur", ownerId: "owner-eur", defaultCurrency: "EUR" }],
      items: [{ id: "item-eur", tripId: "trip-eur", ownerId: "owner-eur", tripDayId: "day-eur" }],
    });
    const service = new ExpenseService(repository);
    await service.setRate("owner-eur", "trip-eur", {
      fromCurrency: "EUR", toCurrency: "CNY", rate: "8",
    });
    const expense = await service.create("owner-eur", "trip-eur", {
      itineraryItemId: "item-eur", amount: "10", currency: "EUR",
    });

    expect(expense).toMatchObject({ settlementCurrency: "CNY", settledAmount: "80.0000" });
    await expect(service.summary("owner-eur", "trip-eur")).resolves.toMatchObject({
      settlementCurrency: "CNY",
      settledActualTotal: "80.0000",
    });
  });
});
