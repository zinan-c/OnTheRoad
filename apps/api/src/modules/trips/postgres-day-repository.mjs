// @ts-nocheck
import {
  PostgresExecutor,
  postgresErrorIdentity,
} from "@on-the-road/database/postgres";

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
  constructor({ databaseUrl, pool, executor }) {
    this.database = executor ?? new PostgresExecutor({
      databaseUrl,
      pool,
      role: "api",
    });
  }

  loadDateContext(ownerId, tripId) {
    return this.#json(
      "SELECT trip_date_context($1, $2::uuid)",
      [ownerId, tripId],
    );
  }

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

  async #json(sql, values = []) {
    try {
      return await this.database.json(sql, values);
    } catch (error) {
      throw mapError(error);
    }
  }
}
