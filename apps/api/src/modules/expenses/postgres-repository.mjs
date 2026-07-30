// @ts-nocheck
import { ExpenseDomainError } from "../../../../../packages/domain/src/expense/index.mjs";
import {
  PostgresExecutor,
  postgresErrorIdentity,
} from "@on-the-road/database/postgres";

function mapDatabaseError(error) {
  const { code, constraint, message } = postgresErrorIdentity(error);
  if (
    code === "23503"
    || constraint?.startsWith("expense_")
    || constraint?.startsWith("exchange_rate_")
  ) {
    return new ExpenseDomainError(
      "EXPENSE_REFERENCE_MISMATCH",
      "Expense references must belong to the same Trip and owner.",
      409,
    );
  }
  if (
    code === "23514"
    || code === "22P02"
    || message === "EXPENSE_REFERENCE_MISMATCH"
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
  constructor({ databaseUrl, pool, executor } = {}) {
    this.database = executor ?? new PostgresExecutor({
      databaseUrl,
      pool,
      role: "api",
    });
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
        WHERE id = $1::uuid
          AND owner_id = $2
          AND status <> 'deleted'
      ), 'null'::jsonb)::text`,
      [tripId, ownerId],
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
        WHERE id = $1::uuid
      ), 'null'::jsonb)::text`,
      [itemId],
    );
  }

  setRate(ownerId, tripId, rate) {
    return this.#json(
      `INSERT INTO trip_exchange_rate (
        trip_id, owner_id, from_currency, to_currency, rate
      )
      VALUES (
        $1::uuid,
        $2,
        $3,
        $4,
        $5::numeric
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
      [tripId, ownerId, rate.fromCurrency, rate.toCurrency, rate.rate],
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
        WHERE trip_id = $1::uuid
          AND from_currency = $2
          AND to_currency = $3
      ), 'null'::jsonb)::text`,
      [tripId, fromCurrency, toCurrency],
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
        $1::uuid,
        $2::uuid,
        $3,
        $4::uuid,
        $5::uuid,
        $6::uuid,
        $7,
        $8,
        $9::numeric,
        $10,
        $11::numeric,
        $12,
        $13::numeric,
        $14
      )
      RETURNING ${this.#expenseJson()}::text`,
      [
        expense.id,
        expense.tripId,
        expense.ownerId,
        expense.tripDayId ?? null,
        expense.itineraryItemId ?? null,
        expense.destinationId ?? null,
        expense.categoryCode,
        expense.transportModeCode ?? null,
        expense.originalAmount,
        expense.currency,
        expense.settledAmount ?? null,
        expense.settlementCurrency,
        expense.exchangeRate ?? null,
        expense.source,
      ],
    );
  }

  list(tripId) {
    return this.#json(
      `SELECT COALESCE(
        jsonb_agg(${this.#expenseJson()} ORDER BY created_at, id),
        '[]'::jsonb
      )::text
      FROM expense
      WHERE trip_id = $1::uuid`,
      [tripId],
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

  close() {
    return this.database.close();
  }

  async #json(sql, values = []) {
    try {
      return await this.database.json(sql, values);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
