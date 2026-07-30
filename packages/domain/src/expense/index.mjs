const MONEY_SCALE = 4;
const RATE_SCALE = 12;

export class ExpenseDomainError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [status]
   */
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ExpenseDomainError";
    this.code = code;
    this.status = status;
  }
}

/**
 * @param {unknown} value
 * @param {number} scale
 * @param {{positive?: boolean}} [options]
 */
function parseFixed(value, scale, { positive = false } = {}) {
  const text = String(value ?? "").normalize("NFKC").trim();
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(text);
  if (!match || (match[2]?.length ?? 0) > scale) {
    throw new ExpenseDomainError(
      "EXPENSE_INVALID",
      `Decimal value must have at most ${scale} fractional digits.`,
    );
  }
  const whole = match[1]?.replace(/^0+(?=\d)/u, "") ?? "0";
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

/** @param {bigint} units @param {number} scale */
function formatFixed(units, scale) {
  const factor = 10n ** BigInt(scale);
  const whole = units / factor;
  const fraction = String(units % factor).padStart(scale, "0");
  return `${whole}.${fraction}`;
}

/** @param {unknown} value */
export function normalizeMoney(value) {
  return formatFixed(parseFixed(value, MONEY_SCALE), MONEY_SCALE);
}

/** @param {unknown} value */
export function normalizeRate(value) {
  return formatFixed(
    parseFixed(value, RATE_SCALE, { positive: true }),
    RATE_SCALE,
  );
}

/** @param {unknown} amount @param {unknown} rate */
export function convertMoney(amount, rate) {
  const amountUnits = parseFixed(amount, MONEY_SCALE);
  const rateUnits = parseFixed(rate, RATE_SCALE, { positive: true });
  const divisor = 10n ** BigInt(RATE_SCALE);
  const settledUnits = (amountUnits * rateUnits + divisor / 2n) / divisor;
  return formatFixed(settledUnits, MONEY_SCALE);
}

/** @param {readonly unknown[]} values */
export function addMoney(values) {
  let total = 0n;
  for (const value of values) total += parseFixed(value, MONEY_SCALE);
  return formatFixed(total, MONEY_SCALE);
}
