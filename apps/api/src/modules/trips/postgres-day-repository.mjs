// @ts-nocheck
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function text(value) {
  return `convert_from(decode('${encode([value])}', 'base64'), 'utf8')::jsonb->>0`;
}

function mapError(error) {
  const message = `${error?.stderr ?? ""}\n${error?.message ?? ""}`;
  if (message.includes("VERSION_CONFLICT")) {
    return Object.assign(new Error("Trip version does not match If-Match"), {
      code: "VERSION_CONFLICT",
      status: 409,
    });
  }
  if (message.includes("TRIP_NOT_FOUND")) {
    return Object.assign(new Error("Trip not found"), { code: "TRIP_NOT_FOUND", status: 404 });
  }
  if (message.includes("DATE_CHANGE_CONFIRMATION_REQUIRED")) {
    return Object.assign(new Error("Date change requires confirmation"), {
      code: "DATE_CHANGE_CONFIRMATION_REQUIRED",
      status: 409,
    });
  }
  return error;
}

export class PostgresTripDayRepository {
  constructor({ databaseUrl, psqlBin = process.env.PSQL_BIN || "psql" }) {
    if (!databaseUrl) throw new TypeError("databaseUrl is required");
    this.databaseUrl = databaseUrl;
    this.psqlBin = psqlBin;
  }

  loadDateContext(ownerId, tripId) {
    return this.#json(
      `SELECT trip_date_context(${text(ownerId)}, (${text(tripId)})::uuid)::text`,
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
        ${text(ownerId)},
        (${text(tripId)})::uuid,
        ${Number(expectedVersion)},
        (${text(startDate)})::date,
        (${text(endDate)})::date,
        ${confirmDestructive ? "true" : "false"}
      )::text`,
    );
  }

  async #json(sql) {
    try {
      const { stdout } = await execFileAsync(
        this.psqlBin,
        [this.databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
        { maxBuffer: 2 * 1024 * 1024 },
      );
      return JSON.parse(stdout.trim() || "null");
    } catch (error) {
      throw mapError(error);
    }
  }
}
