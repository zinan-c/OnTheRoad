// @ts-nocheck
const MONEY_SCALE = 4;
const RATE_SCALE = 12;

export class ExpenseDomainError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ExpenseDomainError";
    this.code = code;
    this.status = status;
  }
}

function parseFixed(value, scale, { positive = false } = {}) {
  const text = String(value ?? "").normalize("NFKC").trim();
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(text);
  if (!match || (match[2]?.length ?? 0) > scale) {
    throw new ExpenseDomainError(
      "EXPENSE_INVALID",
      `Decimal value must have at most ${scale} fractional digits.`,
    );
  }
  const whole = match[1].replace(/^0+(?=\d)/u, "");
  const fraction = (match[2] ?? "").padEnd(scale, "0");
  const units = BigInt(whole) * (10n ** BigInt(scale)) + BigInt(fraction || "0");
  if (positive && units <= 0n) {
    throw new ExpenseDomainError(
      "EXPENSE_INVALID",
      "Exchange rate must be greater than zero.",
    );
  }
  return units;
}

function formatFixed(units, scale) {
  const factor = 10n ** BigInt(scale);
  const whole = units / factor;
  const fraction = String(units % factor).padStart(scale, "0");
  return `${whole}.${fraction}`;
}

export function normalizeMoney(value) {
  return formatFixed(parseFixed(value, MONEY_SCALE), MONEY_SCALE);
}

export function normalizeRate(value) {
  return formatFixed(
    parseFixed(value, RATE_SCALE, { positive: true }),
    RATE_SCALE,
  );
}

export function convertMoney(amount, rate) {
  const amountUnits = parseFixed(amount, MONEY_SCALE);
  const rateUnits = parseFixed(rate, RATE_SCALE, { positive: true });
  const divisor = 10n ** BigInt(RATE_SCALE);
  const settledUnits = (amountUnits * rateUnits + divisor / 2n) / divisor;
  return formatFixed(settledUnits, MONEY_SCALE);
}

export function addMoney(values) {
  return formatFixed(
    values.reduce(
      (total, value) => total + parseFixed(value, MONEY_SCALE),
      0n,
    ),
    MONEY_SCALE,
  );
}
