import {
  PostgresExecutor,
  postgresErrorIdentity,
} from "@on-the-road/database/postgres";

/** @param {unknown} error */
function mapError(error) {
  const { message } = postgresErrorIdentity(error);
  if (message === "VERSION_CONFLICT") {
    return Object.assign(new Error("Trip version does not match If-Match"), {
      code: "VERSION_CONFLICT",
      status: 409,
    });
  }
  if (message === "TRIP_NOT_FOUND") {
    return Object.assign(new Error("Trip not found"), { code: "TRIP_NOT_FOUND", status: 404 });
  }
  if (message === "DATE_CHANGE_CONFIRMATION_REQUIRED") {
    return Object.assign(new Error("Date change requires confirmation"), {
      code: "DATE_CHANGE_CONFIRMATION_REQUIRED",
      status: 409,
    });
  }
  return error;
}

export class PostgresTripDayRepository {
  /**
   * @param {{
   *  databaseUrl?: string,
   *  pool?: import("@on-the-road/database/postgres").PostgresExecutor["pool"],
   *  executor?: import("@on-the-road/database/postgres").PostgresExecutor
   * }} options
   */
  constructor({ databaseUrl, pool, executor }) {
    this.database = executor ?? new PostgresExecutor({
      databaseUrl,
      pool,
      role: "api",
    });
  }

  /** @param {string} ownerId @param {string} tripId */
  loadDateContext(ownerId, tripId) {
    return this.#json(
      "SELECT trip_date_context($1, $2::uuid)",
      [ownerId, tripId],
    );
  }

  /** @param {string} ownerId @param {string} tripId */
  listDays(ownerId, tripId) {
    return this.#json(
      `SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', day.id,
            'tripId', day.trip_id,
            'dayNumber', day.day_number,
            'date', day.date,
            'version', day.version,
            'routeGeneration', day.route_generation
          )
          ORDER BY day.day_number
        ),
        '[]'::jsonb
      )::text
      FROM trip_day day
      JOIN trip ON trip.id = day.trip_id
      WHERE day.trip_id = $1::uuid
        AND trip.owner_id = $2
        AND trip.status <> 'deleted'`,
      [tripId, ownerId],
    );
  }

  /** @param {string} ownerId @param {string} tripId @param {{startDate: string, endDate: string, expectedVersion: number, confirmDestructive: boolean}} input */
  applyDateRange(ownerId, tripId, {
    startDate,
    endDate,
    expectedVersion,
    confirmDestructive,
  }) {
    return this.#json(
      `SELECT apply_trip_date_range(
        $1,
        $2::uuid,
        $3::integer,
        $4::date,
        $5::date,
        $6::boolean
      )`,
      [ownerId, tripId, expectedVersion, startDate, endDate, confirmDestructive],
    );
  }

  close() {
    return this.database.close();
  }

  /** @param {string} sql @param {readonly unknown[]} [values] */
  async #json(sql, values = []) {
    try {
      return await this.database.json(sql, values);
    } catch (error) {
      throw mapError(error);
    }
  }
}
