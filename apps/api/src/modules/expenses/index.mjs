// @ts-nocheck
import { randomUUID } from "node:crypto";

import {
  addMoney,
  convertMoney,
  ExpenseDomainError,
  normalizeMoney,
  normalizeRate,
} from "../../../../../packages/domain/src/expense/index.mjs";
import {
  costCategories,
  currencies,
  normalizeCurrencyCode,
} from "../../../../../packages/config/src/reference-data.mjs";

const CURRENCY_CODES = new Set(currencies.map(({ code }) => code));
const CATEGORY_CODES = new Set(costCategories.map(({ code }) => code));

function currency(value) {
  try {
    return normalizeCurrencyCode(String(value ?? ""));
  } catch {
    throw new ExpenseDomainError(
      "EXPENSE_CURRENCY_UNSUPPORTED",
      "Expense currency is not supported.",
    );
  }
}

function category(value) {
  const code = String(value ?? "").trim().toUpperCase();
  if (!CATEGORY_CODES.has(code)) {
    throw new ExpenseDomainError(
      "EXPENSE_CATEGORY_UNSUPPORTED",
      "Expense category is not supported.",
    );
  }
  return code;
}

export class ExpenseService {
  constructor(repository) {
    this.repository = repository;
  }

  async setRate(ownerId, tripId, input) {
    const fromCurrency = currency(input.fromCurrency);
    const toCurrency = currency(input.toCurrency);
    if (fromCurrency === toCurrency) {
      throw new ExpenseDomainError(
        "EXPENSE_INVALID",
        "Exchange rate currencies must differ.",
      );
    }
    return this.repository.setRate(ownerId, tripId, {
      fromCurrency,
      toCurrency,
      rate: normalizeRate(input.rate),
    });
  }

  async create(ownerId, tripId, input) {
    const trip = await this.repository.getTrip(ownerId, tripId);
    const originalCurrency = currency(input.currency);
    const originalAmount = normalizeMoney(input.amount);
    const categoryCode = category(input.categoryCode);
    if (input.itineraryItemId) {
      const item = await this.repository.getItem(input.itineraryItemId);
      if (
        !item
        || item.ownerId !== ownerId
        || item.tripId !== tripId
      ) {
        throw new ExpenseDomainError(
          "EXPENSE_REFERENCE_MISMATCH",
          "Expense Item must belong to the same Trip and owner.",
          409,
        );
      }
    }
    const exchangeRate = originalCurrency === trip.defaultCurrency
      ? "1.000000000000"
      : await this.repository.getRate(
        tripId,
        originalCurrency,
        trip.defaultCurrency,
      );
    return this.repository.create({
      id: randomUUID(),
      ownerId,
      tripId,
      itineraryItemId: input.itineraryItemId ?? null,
      destinationId: input.destinationId ?? null,
      transportModeCode: input.transportModeCode ?? null,
      categoryCode,
      originalAmount,
      currency: originalCurrency,
      settlementCurrency: trip.defaultCurrency,
      exchangeRate: exchangeRate?.rate ?? exchangeRate ?? null,
      settledAmount: exchangeRate
        ? convertMoney(
          originalAmount,
          exchangeRate.rate ?? exchangeRate,
        )
        : null,
      source: input.source ?? "actual",
      version: 1,
    });
  }

  async summary(ownerId, tripId) {
    const trip = await this.repository.getTrip(ownerId, tripId);
    const expenses = (await this.repository.list(tripId))
      .filter(({ source }) => source === "actual");
    const original = {};
    const rateSnapshots = new Map();
    const unconverted = [];
    for (const expense of expenses) {
      original[expense.currency] = addMoney([
        original[expense.currency] ?? "0",
        expense.originalAmount,
      ]);
      if (!expense.settledAmount) {
        unconverted.push({
          currency: expense.currency,
          amount: expense.originalAmount,
        });
      } else if (expense.currency !== expense.settlementCurrency) {
        const key = `${expense.currency}:${expense.settlementCurrency}:${expense.exchangeRate}`;
        rateSnapshots.set(key, {
          fromCurrency: expense.currency,
          toCurrency: expense.settlementCurrency,
          rate: expense.exchangeRate,
        });
      }
    }
    return {
      settlementCurrency: trip.defaultCurrency,
      settledActualTotal: addMoney(
        expenses.flatMap(({ settledAmount }) =>
          settledAmount ? [settledAmount] : []),
      ),
      originalCurrencyTotals: Object.fromEntries(
        Object.entries(original).sort(([left], [right]) =>
          left.localeCompare(right)),
      ),
      unconverted,
      rateSnapshots: [...rateSnapshots.values()],
    };
  }
}

export class InMemoryExpenseRepository {
  constructor({ trips = [], items = [] } = {}) {
    this.trips = new Map(trips.map((trip) => [trip.id, { ...trip }]));
    this.items = new Map(items.map((item) => [item.id, { ...item }]));
    this.rates = new Map();
    this.expenses = [];
  }

  getTrip(ownerId, tripId) {
    const trip = this.trips.get(tripId);
    if (!trip || trip.ownerId !== ownerId) {
      throw new ExpenseDomainError(
        "EXPENSE_TRIP_NOT_FOUND",
        "Trip was not found.",
        404,
      );
    }
    return { ...trip };
  }

  getItem(itemId) {
    const item = this.items.get(itemId);
    return item ? { ...item } : undefined;
  }

  setRate(ownerId, tripId, rate) {
    this.getTrip(ownerId, tripId);
    const stored = { ...rate, ownerId, tripId, version: 1 };
    this.rates.set(`${tripId}:${rate.fromCurrency}:${rate.toCurrency}`, stored);
    return { ...stored };
  }

  getRate(tripId, fromCurrency, toCurrency) {
    const rate = this.rates.get(`${tripId}:${fromCurrency}:${toCurrency}`);
    return rate ? { ...rate } : null;
  }

  create(expense) {
    if (!CURRENCY_CODES.has(expense.currency)) {
      throw new ExpenseDomainError(
        "EXPENSE_CURRENCY_UNSUPPORTED",
        "Expense currency is not supported.",
      );
    }
    this.expenses.push({ ...expense });
    return { ...expense };
  }

  list(tripId) {
    return this.expenses
      .filter((expense) => expense.tripId === tripId)
      .map((expense) => ({ ...expense }));
  }
}

export { PostgresExpenseRepository } from "./postgres-repository.mjs";
