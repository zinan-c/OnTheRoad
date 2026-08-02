import { addMoney } from "@on-the-road/domain/expense";

const DIMENSIONS = Object.freeze({
  day: (/** @type {any} */ expense) => expense.tripDayId ?? "unassigned",
  destination: (/** @type {any} */ expense) => expense.destinationId ?? "unassigned",
  category: (/** @type {any} */ expense) => expense.categoryCode ?? "unassigned",
  mode: (/** @type {any} */ expense) => expense.transportModeCode ?? "unassigned",
  currency: (/** @type {any} */ expense) => expense.currency ?? "unassigned",
});

/** @param {Record<string, any>} target @param {string} key @param {Record<string, any>} expense */
function add(target, key, expense) {
  const current = target[key] ?? { originalTotal: "0.0000", settledTotal: "0.0000", unconverted: "0" };
  target[key] = {
    originalTotal: addMoney([current.originalTotal, expense.originalAmount]),
    settledTotal: expense.settledAmount ? addMoney([current.settledTotal, expense.settledAmount]) : current.settledTotal,
    unconverted: String(Number(current.unconverted) + (expense.settledAmount ? 0 : 1)),
  };
}

/** @param {readonly Record<string, any>[]} expenses @param {string} settlementCurrency */
export function summarizeExpenses(expenses, settlementCurrency) {
  /** @type {Record<string, Record<string, {originalTotal: string, settledTotal: string, unconverted: string}>>} */
  const breakdowns = { day: {}, destination: {}, category: {}, mode: {}, currency: {} };
  /** @type {Record<string, string>} */
  const originalCurrencyTotals = {};
  const unconverted = [];
  const rateSnapshots = new Map();
  for (const expense of expenses) {
    originalCurrencyTotals[expense.currency] = addMoney([originalCurrencyTotals[expense.currency] ?? "0", expense.originalAmount]);
    if (!expense.settledAmount) unconverted.push({ currency: expense.currency, amount: expense.originalAmount });
    else if (expense.currency !== expense.settlementCurrency) {
      const key = `${expense.currency}:${expense.settlementCurrency}:${expense.exchangeRate}`;
      rateSnapshots.set(key, { fromCurrency: expense.currency, toCurrency: expense.settlementCurrency, rate: expense.exchangeRate });
    }
    for (const [dimension, keyOf] of Object.entries(DIMENSIONS)) {
      const bucket = breakdowns[dimension] ?? {};
      breakdowns[dimension] = bucket;
      add(bucket, keyOf(expense), expense);
    }
  }
  return {
    settlementCurrency,
    settledActualTotal: addMoney(expenses.flatMap(({ settledAmount }) => settledAmount ? [settledAmount] : [])),
    originalCurrencyTotals: Object.fromEntries(Object.entries(originalCurrencyTotals).sort(([left], [right]) => left.localeCompare(right))),
    unconverted,
    rateSnapshots: [...rateSnapshots.values()],
    breakdowns,
  };
}
