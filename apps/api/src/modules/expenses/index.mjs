import { randomUUID } from "node:crypto";

import {
  convertMoney,
  ExpenseDomainError,
  normalizeMoney,
  normalizeRate,
} from "@on-the-road/domain/expense";
import {
  costCategories,
  currencies,
  normalizeCurrencyCode,
} from "@on-the-road/config/reference-data";
import { summarizeExpenses } from "./summary.mjs";

const CURRENCY_CODES = new Set(currencies.map(({ code }) => code));
const CATEGORY_CODES = new Set(costCategories.map(({ code }) => code));
const REPORTING_CURRENCY = "CNY";

/** @param {unknown} value */
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

/** @param {unknown} value */
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

/** @param {unknown} value */
function remark(value) {
  const normalized = String(value ?? "").trim();
  if (normalized.length > 2_000) {
    throw new ExpenseDomainError(
      "EXPENSE_INVALID",
      "Expense notes must not exceed 2000 characters.",
    );
  }
  return normalized || null;
}

export class ExpenseService {
  /** @param {any} repository */
  constructor(repository) {
    this.repository = repository;
  }

  /** @param {string} ownerId @param {string} tripId @param {Record<string, any>} input */
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

  /** @param {string} ownerId @param {string} tripId */
  async listRates(ownerId, tripId) {
    await this.repository.getTrip(ownerId, tripId);
    return this.repository.listRates(ownerId, tripId);
  }

  /** @param {string} ownerId @param {string} tripId @param {Record<string, any>} input */
  async create(ownerId, tripId, input) {
    await this.repository.getTrip(ownerId, tripId);
    const originalCurrency = currency(input.currency);
    const originalAmount = normalizeMoney(input.amount);
    const categoryCode = category(input.categoryCode ?? "OTHER");
    let item = null;
    if (input.itineraryItemId) {
      item = await this.repository.getItem(input.itineraryItemId);
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
    const exchangeRate = originalCurrency === REPORTING_CURRENCY
      ? "1.000000000000"
      : await this.repository.getRate(
        tripId,
        originalCurrency,
        REPORTING_CURRENCY,
      );
    return this.repository.create({
      id: randomUUID(),
      ownerId,
      tripId,
      tripDayId: item?.tripDayId ?? null,
      itineraryItemId: input.itineraryItemId ?? null,
      destinationId: input.destinationId ?? null,
      transportModeCode: input.transportModeCode ?? null,
      categoryCode,
      remark: remark(input.remark),
      originalAmount,
      currency: originalCurrency,
      settlementCurrency: REPORTING_CURRENCY,
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

  /** @param {string} ownerId @param {string} tripId @param {string} itemId */
  async listForItem(ownerId, tripId, itemId) {
    await this.repository.getTrip(ownerId, tripId);
    const item = await this.repository.getItem(itemId);
    if (!item || item.ownerId !== ownerId || item.tripId !== tripId) {
      throw new ExpenseDomainError(
        "EXPENSE_REFERENCE_MISMATCH",
        "Expense Item must belong to the same Trip and owner.",
        409,
      );
    }
    return this.repository.listByItem(ownerId, tripId, itemId);
  }

  /** @param {string} ownerId @param {string} tripId @param {string} expenseId @param {Record<string, any>} input @param {number} expectedVersion */
  async update(ownerId, tripId, expenseId, input, expectedVersion) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new ExpenseDomainError("EXPENSE_VERSION_INVALID", "Expense version is invalid.");
    }
    await this.repository.getTrip(ownerId, tripId);
    const current = await this.repository.getExpense(ownerId, tripId, expenseId);
    if (!current) {
      throw new ExpenseDomainError("EXPENSE_NOT_FOUND", "Expense was not found.", 404);
    }
    const originalCurrency = currency(input.currency);
    const originalAmount = normalizeMoney(input.amount);
    const categoryCode = category(input.categoryCode ?? current.categoryCode ?? "OTHER");
    const exchangeRate = originalCurrency === REPORTING_CURRENCY
      ? "1.000000000000"
      : await this.repository.getRate(tripId, originalCurrency, REPORTING_CURRENCY);
    return this.repository.update(ownerId, tripId, expenseId, expectedVersion, {
      originalAmount,
      currency: originalCurrency,
      categoryCode,
      remark: remark(input.remark),
      settlementCurrency: REPORTING_CURRENCY,
      exchangeRate: exchangeRate?.rate ?? exchangeRate ?? null,
      settledAmount: exchangeRate
        ? convertMoney(originalAmount, exchangeRate.rate ?? exchangeRate)
        : null,
    });
  }

  /** @param {string} ownerId @param {string} tripId */
  async summary(ownerId, tripId) {
    await this.repository.getTrip(ownerId, tripId);
    const expenses = /** @type {Record<string, any>[]} */ (
      await this.repository.list(tripId)
    ).filter(({ source }) => source === "actual");
    return summarizeExpenses(expenses, REPORTING_CURRENCY);
  }
}

export class InMemoryExpenseRepository {
  /** @param {{trips?: Record<string, any>[], items?: Record<string, any>[]}} [options] */
  constructor({ trips = [], items = [] } = {}) {
    this.trips = new Map(trips.map((trip) => [trip.id, { ...trip }]));
    this.items = new Map(items.map((item) => [item.id, { ...item }]));
    /** @type {Map<string, Record<string, any>>} */
    this.rates = new Map();
    /** @type {Record<string, any>[]} */
    this.expenses = [];
  }

  /** @param {string} ownerId @param {string} tripId */
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

  /** @param {string} itemId */
  getItem(itemId) {
    const item = this.items.get(itemId);
    return item ? { ...item } : undefined;
  }

  /** @param {string} ownerId @param {string} tripId @param {string} expenseId */
  getExpense(ownerId, tripId, expenseId) {
    const expense = this.expenses.find((entry) => entry.id === expenseId
      && entry.ownerId === ownerId && entry.tripId === tripId);
    return expense ? { ...expense } : null;
  }

  /** @param {string} ownerId @param {string} tripId @param {Record<string, any>} rate */
  setRate(ownerId, tripId, rate) {
    this.getTrip(ownerId, tripId);
    const stored = { ...rate, ownerId, tripId, version: 1 };
    this.rates.set(`${tripId}:${rate.fromCurrency}:${rate.toCurrency}`, stored);
    const reconciledExpenseIds = [];
    for (const expense of this.expenses) {
      if (expense.tripId !== tripId || expense.ownerId !== ownerId
        || expense.currency !== rate.fromCurrency
        || expense.settlementCurrency !== rate.toCurrency
        || expense.settledAmount !== null || expense.exchangeRate !== null
        || expense.source !== "actual") continue;
      expense.exchangeRate = rate.rate;
      expense.settledAmount = convertMoney(expense.originalAmount, rate.rate);
      expense.version += 1;
      reconciledExpenseIds.push(expense.id);
    }
    return { ...stored, reconciledExpenseIds };
  }

  /** @param {string} ownerId @param {string} tripId */
  listRates(ownerId, tripId) {
    this.getTrip(ownerId, tripId);
    return [...this.rates.values()].filter((rate) => rate.ownerId === ownerId
      && rate.tripId === tripId).map((rate) => ({ ...rate }));
  }

  /** @param {string} tripId @param {string} fromCurrency @param {string} toCurrency */
  getRate(tripId, fromCurrency, toCurrency) {
    const rate = this.rates.get(`${tripId}:${fromCurrency}:${toCurrency}`);
    return rate ? { ...rate } : null;
  }

  /** @param {Record<string, any>} expense */
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

  /** @param {string} tripId */
  list(tripId) {
    return this.expenses
      .filter((expense) => expense.tripId === tripId)
      .map((expense) => ({ ...expense }));
  }

  /** @param {string} ownerId @param {string} tripId @param {string} itemId */
  listByItem(ownerId, tripId, itemId) {
    return this.expenses.filter((expense) => expense.ownerId === ownerId
      && expense.tripId === tripId && expense.itineraryItemId === itemId
      && expense.source === "actual").map((expense) => ({ ...expense }));
  }

  /** @param {string} ownerId @param {string} tripId @param {string} expenseId @param {number} expectedVersion @param {Record<string, any>} patch */
  update(ownerId, tripId, expenseId, expectedVersion, patch) {
    const index = this.expenses.findIndex((expense) => expense.id === expenseId
      && expense.ownerId === ownerId && expense.tripId === tripId);
    const current = this.expenses[index];
    if (!current) return null;
    if (current.version !== expectedVersion) {
      throw new ExpenseDomainError("EXPENSE_VERSION_CONFLICT", "Expense changed; reload before saving.", 409);
    }
    this.expenses[index] = { ...current, ...patch, version: expectedVersion + 1 };
    return { ...this.expenses[index] };
  }
}

export { PostgresExpenseRepository } from "./postgres-repository.mjs";
