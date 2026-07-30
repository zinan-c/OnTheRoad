// @ts-nocheck
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  assertCompleteDayOrder,
  assertBaseDayVersion,
  ItineraryOrderDayNotFoundError,
  ItineraryOrderError,
  ItineraryOrderVersionConflictError,
} from "../../../../../packages/domain/src/itinerary/order.mjs";
import {
  assertItineraryId,
  assertItineraryOwner,
} from "../../../../../packages/domain/src/itinerary/index.mjs";

const execFileAsync = promisify(execFile);

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function jsonExpression(value) {
  return `convert_from(decode('${encode(value)}', 'base64'), 'utf8')::jsonb`;
}

function mapDatabaseError(error) {
  const message = `${error?.stderr ?? ""}\n${error?.message ?? ""}`;
  if (message.includes("ITINERARY_ORDER_VERSION_CONFLICT")) {
    return new ItineraryOrderVersionConflictError();
  }
  if (message.includes("ITINERARY_ORDER_DAY_NOT_FOUND")) {
    return new ItineraryOrderDayNotFoundError();
  }
  if (message.includes("ITINERARY_ORDER_SET_MISMATCH")) {
    return new ItineraryOrderError(
      "ITINERARY_ORDER_SET_MISMATCH",
      "orderedIds must be the complete unique ID set for one Day.",
      422,
    );
  }
  return error;
}

export class PostgresItineraryOrderRepository {
  constructor({ databaseUrl, psqlBin = process.env.PSQL_BIN || "psql" }) {
    if (!databaseUrl) throw new TypeError("databaseUrl is required");
    this.databaseUrl = databaseUrl;
    this.psqlBin = psqlBin;
  }

  async reorder(ownerId, tripId, tripDayId, baseVersion, orderedIds) {
    try {
      const { stdout } = await execFileAsync(
        this.psqlBin,
        [
          this.databaseUrl,
          "-X",
          "-q",
          "-v",
          "ON_ERROR_STOP=1",
          "-At",
          "-c",
          `SELECT reorder_itinerary_items(
            ${jsonExpression([ownerId])}->>0,
            (${jsonExpression([tripId])}->>0)::uuid,
            (${jsonExpression([tripDayId])}->>0)::uuid,
            (${jsonExpression([baseVersion])}->>0)::integer,
            ${jsonExpression(orderedIds)}
          )::text`,
        ],
        { maxBuffer: 2 * 1024 * 1024 },
      );
      return JSON.parse(stdout.trim() || "null");
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}

export class ItineraryOrderService {
  constructor(repository) {
    if (!repository || typeof repository.reorder !== "function") {
      throw new TypeError("repository.reorder is required");
    }
    this.repository = repository;
  }

  reorder(ownerId, tripId, tripDayId, input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new ItineraryOrderError(
        "ITINERARY_ORDER_SET_MISMATCH",
        "reorder input must be an object.",
        422,
      );
    }
    const orderedIds = assertCompleteDayOrder(
      input.orderedIds,
      input.orderedIds,
    );
    return this.repository.reorder(
      assertItineraryOwner(ownerId),
      assertItineraryId(tripId, "tripId"),
      assertItineraryId(tripDayId, "tripDayId"),
      assertBaseDayVersion(input.baseVersion),
      orderedIds,
    );
  }
}
