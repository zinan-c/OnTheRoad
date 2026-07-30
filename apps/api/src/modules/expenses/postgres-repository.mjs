// @ts-nocheck
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ExpenseDomainError } from "../../../../../packages/domain/src/expense/index.mjs";

const execFileAsync = promisify(execFile);

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function json(value) {
  return `convert_from(decode('${encode(value)}', 'base64'), 'utf8')::jsonb`;
}

function text(value) {
  return `${json([value])}->>0`;
}

function nullableUuid(value) {
  return value ? `(${text(value)})::uuid` : "NULL";
}

function mapDatabaseError(error) {
  const message = `${error?.stderr ?? ""}\n${error?.message ?? ""}`;
  if (
    message.includes("expense_")
    || message.includes("exchange_rate_")
    || message.includes("violates foreign key constraint")
  ) {
    return new ExpenseDomainError(
      "EXPENSE_REFERENCE_MISMATCH",
      "Expense references must belong to the same Trip and owner.",
      409,
    );
  }
  if (
    message.includes("violates check constraint")
    || message.includes("invalid input syntax")
  ) {
    return new ExpenseDomainError(
      "EXPENSE_INVALID",
      "Expense violates a database invariant.",
      422,
    );
  }
  return error;
}

export class PostgresExpenseRepository {
  constructor({ databaseUrl, psqlBin = process.env.PSQL_BIN || "psql" }) {
    if (!databaseUrl) throw new TypeError("databaseUrl is required");
    this.databaseUrl = databaseUrl;
    this.psqlBin = psqlBin;
  }

  async getTrip(ownerId, tripId) {
    const trip = await this.#json(
      `SELECT COALESCE((
        SELECT jsonb_build_object(
          'id', id,
          'ownerId', owner_id,
          'defaultCurrency', default_currency
        )
        FROM trip
        WHERE id = (${text(tripId)})::uuid
          AND owner_id = ${text(ownerId)}
          AND status <> 'deleted'
      ), 'null'::jsonb)::text`,
    );
    if (!trip) {
      throw new ExpenseDomainError(
        "EXPENSE_TRIP_NOT_FOUND",
        "Trip was not found.",
        404,
      );
    }
    return trip;
  }

  getItem(itemId) {
    return this.#json(
      `SELECT COALESCE((
        SELECT jsonb_build_object(
          'id', id,
          'tripId', trip_id,
          'ownerId', owner_id,
          'tripDayId', trip_day_id
        )
        FROM itinerary_item
        WHERE id = (${text(itemId)})::uuid
      ), 'null'::jsonb)::text`,
    );
  }

  setRate(ownerId, tripId, rate) {
    return this.#json(
      `INSERT INTO trip_exchange_rate (
        trip_id, owner_id, from_currency, to_currency, rate
      )
      VALUES (
        (${text(tripId)})::uuid,
        ${text(ownerId)},
        ${text(rate.fromCurrency)},
        ${text(rate.toCurrency)},
        (${text(rate.rate)})::numeric
      )
      ON CONFLICT (trip_id, from_currency, to_currency)
      DO UPDATE SET
        owner_id = EXCLUDED.owner_id,
        rate = EXCLUDED.rate,
        version = trip_exchange_rate.version + 1,
        effective_at = now(),
        updated_at = now()
      RETURNING jsonb_build_object(
        'tripId', trip_id,
        'ownerId', owner_id,
        'fromCurrency', from_currency,
        'toCurrency', to_currency,
        'rate', to_char(rate, 'FM9999999999999990.000000000000'),
        'version', version
      )::text`,
    );
  }

  getRate(tripId, fromCurrency, toCurrency) {
    return this.#json(
      `SELECT COALESCE((
        SELECT jsonb_build_object(
          'rate', to_char(rate, 'FM9999999999999990.000000000000'),
          'version', version
        )
        FROM trip_exchange_rate
        WHERE trip_id = (${text(tripId)})::uuid
          AND from_currency = ${text(fromCurrency)}
          AND to_currency = ${text(toCurrency)}
      ), 'null'::jsonb)::text`,
    );
  }

  create(expense) {
    return this.#json(
      `INSERT INTO expense (
        id, trip_id, owner_id, trip_day_id, itinerary_item_id,
        destination_id, category_code, transport_mode_code,
        original_amount, original_currency, settlement_amount,
        settlement_currency, exchange_rate_snapshot, source
      )
      VALUES (
        (${text(expense.id)})::uuid,
        (${text(expense.tripId)})::uuid,
        ${text(expense.ownerId)},
        ${nullableUuid(expense.tripDayId)},
        ${nullableUuid(expense.itineraryItemId)},
        ${nullableUuid(expense.destinationId)},
        ${text(expense.categoryCode)},
        ${expense.transportModeCode ? text(expense.transportModeCode) : "NULL"},
        (${text(expense.originalAmount)})::numeric,
        ${text(expense.currency)},
        ${expense.settledAmount ? `(${text(expense.settledAmount)})::numeric` : "NULL"},
        ${text(expense.settlementCurrency)},
        ${expense.exchangeRate ? `(${text(expense.exchangeRate)})::numeric` : "NULL"},
        ${text(expense.source)}
      )
      RETURNING ${this.#expenseJson()}::text`,
    );
  }

  list(tripId) {
    return this.#json(
      `SELECT COALESCE(
        jsonb_agg(${this.#expenseJson()} ORDER BY created_at, id),
        '[]'::jsonb
      )::text
      FROM expense
      WHERE trip_id = (${text(tripId)})::uuid`,
    );
  }

  #expenseJson() {
    return `jsonb_build_object(
      'id', id,
      'tripId', trip_id,
      'ownerId', owner_id,
      'tripDayId', trip_day_id,
      'itineraryItemId', itinerary_item_id,
      'destinationId', destination_id,
      'transportModeCode', transport_mode_code,
      'categoryCode', category_code,
      'originalAmount', to_char(original_amount, 'FM9999999999999990.0000'),
      'currency', original_currency,
      'settlementCurrency', settlement_currency,
      'exchangeRate', CASE WHEN exchange_rate_snapshot IS NULL THEN NULL
        ELSE to_char(exchange_rate_snapshot, 'FM9999999999999990.000000000000')
      END,
      'settledAmount', CASE WHEN settlement_amount IS NULL THEN NULL
        ELSE to_char(settlement_amount, 'FM9999999999999990.0000')
      END,
      'source', source,
      'version', version
    )`;
  }

  async #json(sql) {
    try {
      const { stdout } = await execFileAsync(
        this.psqlBin,
        [this.databaseUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
        { maxBuffer: 4 * 1024 * 1024 },
      );
      return JSON.parse(stdout.trim() || "null");
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
