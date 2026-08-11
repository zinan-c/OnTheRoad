import { ExpenseDomainError } from "@on-the-road/domain/expense";
import {
  PostgresExecutor,
  postgresErrorIdentity,
} from "@on-the-road/database/postgres";

/** @param {unknown} error */
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
  /**
   * @param {{
   *  databaseUrl?: string,
   *  pool?: import("@on-the-road/database/postgres").PostgresExecutor["pool"],
   *  executor?: import("@on-the-road/database/postgres").PostgresExecutor
   * }} [options]
   */
  constructor({ databaseUrl, pool, executor } = {}) {
    this.database = executor ?? new PostgresExecutor({
      databaseUrl,
      pool,
      role: "api",
    });
  }

  /** @param {string} ownerId @param {string} tripId */
  async getTrip(ownerId, tripId) {
    const trip = /** @type {{id: string, ownerId: string, defaultCurrency: string} | null} */ (await this.#json(
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
    ));
    if (!trip) {
      throw new ExpenseDomainError(
        "EXPENSE_TRIP_NOT_FOUND",
        "Trip was not found.",
        404,
      );
    }
    return trip;
  }

  /** @param {string} itemId */
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

  /** @param {string} ownerId @param {string} tripId @param {string} expenseId */
  getExpense(ownerId, tripId, expenseId) {
    return this.#json(
      `SELECT COALESCE((
        SELECT ${this.#expenseJson()}
        FROM expense
        WHERE id = $3::uuid AND trip_id = $2::uuid AND owner_id = $1
      ), 'null'::jsonb)::text`,
      [ownerId, tripId, expenseId],
    );
  }

  /** @param {string} ownerId @param {string} tripId @param {{fromCurrency: string, toCurrency: string, rate: string}} rate */
  setRate(ownerId, tripId, rate) {
    return this.#json(
      `WITH saved AS (
        INSERT INTO trip_exchange_rate (
          trip_id, owner_id, from_currency, to_currency, rate
        )
        VALUES ($1::uuid, $2, $3, $4, $5::numeric)
        ON CONFLICT (trip_id, from_currency, to_currency)
        DO UPDATE SET
          owner_id = EXCLUDED.owner_id,
          rate = EXCLUDED.rate,
          version = trip_exchange_rate.version + 1,
          effective_at = now(),
          updated_at = now()
        RETURNING *
      ), reconciled AS (
        UPDATE expense e
        SET settlement_amount = round(e.original_amount * saved.rate, 4),
            exchange_rate_snapshot = saved.rate,
            version = e.version + 1,
            updated_at = now()
        FROM saved
        WHERE e.trip_id = saved.trip_id
          AND e.owner_id = saved.owner_id
          AND e.original_currency = saved.from_currency
          AND e.settlement_currency = saved.to_currency
          AND e.settlement_amount IS NULL
          AND e.exchange_rate_snapshot IS NULL
          AND e.source = 'actual'
        RETURNING e.id
      )
      SELECT jsonb_build_object(
        'tripId', saved.trip_id,
        'ownerId', saved.owner_id,
        'fromCurrency', saved.from_currency,
        'toCurrency', saved.to_currency,
        'rate', to_char(saved.rate, 'FM9999999999999990.000000000000'),
        'version', saved.version,
        'reconciledExpenseIds', COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM reconciled), '[]'::jsonb)
      )
      FROM saved`,
      [tripId, ownerId, rate.fromCurrency, rate.toCurrency, rate.rate],
    );
  }

  /** @param {string} ownerId @param {string} tripId */
  listRates(ownerId, tripId) {
    return this.#json(
      `SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'tripId', trip_id,
        'ownerId', owner_id,
        'fromCurrency', from_currency,
        'toCurrency', to_currency,
        'rate', to_char(rate, 'FM9999999999999990.000000000000'),
        'version', version
      ) ORDER BY from_currency, to_currency), '[]'::jsonb)
      FROM trip_exchange_rate
      WHERE trip_id = $2::uuid AND owner_id = $1`,
      [ownerId, tripId],
    );
  }

  /** @param {string} tripId @param {string} fromCurrency @param {string} toCurrency */
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

  /** @param {Record<string, any>} expense */
  create(expense) {
    return this.#json(
      `INSERT INTO expense (
        id, trip_id, owner_id, trip_day_id, itinerary_item_id,
        destination_id, category_code, transport_mode_code,
        original_amount, original_currency, settlement_amount,
        settlement_currency, exchange_rate_snapshot, source, remark
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
        $14,
        $15
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
        expense.remark ?? null,
      ],
    );
  }

  /** @param {string} tripId */
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

  /** @param {string} ownerId @param {string} tripId @param {string} itemId */
  listByItem(ownerId, tripId, itemId) {
    return this.#json(
      `SELECT COALESCE(
        jsonb_agg(${this.#expenseJson()} ORDER BY created_at, id),
        '[]'::jsonb
      )::text
      FROM expense
      WHERE owner_id = $1 AND trip_id = $2::uuid
        AND itinerary_item_id = $3::uuid AND source = 'actual'`,
      [ownerId, tripId, itemId],
    );
  }

  /** @param {string} ownerId @param {string} tripId @param {string} expenseId @param {number} expectedVersion @param {Record<string, any>} patch */
  async update(ownerId, tripId, expenseId, expectedVersion, patch) {
    const updated = await this.#json(
      `WITH changed AS (
        UPDATE expense
        SET original_amount = $5::numeric,
            original_currency = $6,
            category_code = $7,
            settlement_amount = $8::numeric,
            settlement_currency = $9,
            exchange_rate_snapshot = $10::numeric,
            remark = $11,
            version = version + 1,
            updated_at = now()
        WHERE id = $3::uuid AND trip_id = $2::uuid AND owner_id = $1
          AND version = $4
        RETURNING ${this.#expenseJson()}
      )
      SELECT COALESCE((SELECT * FROM changed), 'null'::jsonb)::text`,
      [ownerId, tripId, expenseId, expectedVersion, patch.originalAmount,
        patch.currency, patch.categoryCode, patch.settledAmount,
        patch.settlementCurrency, patch.exchangeRate, patch.remark ?? null],
    );
    if (!updated) {
      const current = await this.getExpense(ownerId, tripId, expenseId);
      if (!current) throw new ExpenseDomainError("EXPENSE_NOT_FOUND", "Expense was not found.", 404);
      throw new ExpenseDomainError("EXPENSE_VERSION_CONFLICT", "Expense changed; reload before saving.", 409);
    }
    return updated;
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
      'remark', remark,
      'version', version
    )`;
  }

  close() {
    return this.database.close();
  }

  /** @param {string} sql @param {readonly unknown[]} [values] */
  async #json(sql, values = []) {
    try {
      return await this.database.json(sql, values);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
