// @ts-nocheck
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  IdempotencyKeyReusedError,
  TripNotFoundError,
  TripVersionConflictError,
} from "../../../../../packages/domain/src/trip/index.mjs";

const execFileAsync = promisify(execFile);

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function jsonExpression(value) {
  return `convert_from(decode('${encode(value)}', 'base64'), 'utf8')::jsonb`;
}

function mapDatabaseError(error) {
  const message = `${error?.stderr ?? ""}\n${error?.message ?? ""}`;
  if (message.includes("VERSION_CONFLICT")) return new TripVersionConflictError();
  if (message.includes("TRIP_NOT_FOUND")) return new TripNotFoundError();
  if (message.includes("IDEMPOTENCY_KEY_REUSED")) return new IdempotencyKeyReusedError();
  return error;
}

export class PostgresTripRepository {
  constructor({ databaseUrl, psqlBin = process.env.PSQL_BIN || "psql" }) {
    if (!databaseUrl) throw new TypeError("databaseUrl is required");
    this.databaseUrl = databaseUrl;
    this.psqlBin = psqlBin;
  }

  async create(ownerId, idempotencyKey, requestHash, input) {
    return this.#json(
      `SELECT create_trip(
        ${jsonExpression([ownerId])}->>0,
        ${jsonExpression([idempotencyKey])}->>0,
        ${jsonExpression([requestHash])}->>0,
        ${jsonExpression(input)}
      )::text`,
    );
  }

  async get(ownerId, tripId, { includeDeleted = false } = {}) {
    const result = await this.#json(
      `SELECT COALESCE(
        (
          SELECT trip_as_json(t.id)
          FROM trip t
          WHERE t.id = (${jsonExpression([tripId])}->>0)::uuid
            AND t.owner_id = ${jsonExpression([ownerId])}->>0
            ${includeDeleted ? "" : "AND t.status <> 'deleted'"}
        ),
        'null'::jsonb
      )::text`,
    );
    if (result === null) throw new TripNotFoundError();
    return result;
  }

  async list(ownerId, filters) {
    return this.#json(
      `WITH criteria AS (SELECT ${jsonExpression({
        ownerId,
        search: filters.search ?? "",
        currency: filters.currency ?? "",
        status: filters.status ?? "active",
      })} AS value),
      matching AS (
        SELECT t.*
        FROM trip t, criteria c
        WHERE t.owner_id = c.value->>'ownerId'
          AND t.status = COALESCE(NULLIF(c.value->>'status', ''), 'active')
          AND (
            NULLIF(c.value->>'currency', '') IS NULL
            OR t.default_currency = c.value->>'currency'
          )
          AND (
            NULLIF(c.value->>'search', '') IS NULL
            OR t.name ILIKE '%' || (c.value->>'search') || '%'
            OR EXISTS (
              SELECT 1 FROM destination d
              WHERE d.trip_id = t.id
                AND d.name ILIKE '%' || (c.value->>'search') || '%'
            )
        )
        ORDER BY t.updated_at DESC, t.id
        LIMIT ${filters.limit ?? 20}
      )
      SELECT jsonb_build_object(
        'items', COALESCE(jsonb_agg(trip_as_json(m.id) ORDER BY m.updated_at DESC, m.id), '[]'::jsonb),
        'nextCursor', NULL
      )::text
      FROM matching m`,
    );
  }

  async update(ownerId, tripId, expectedVersion, patch) {
    return this.#json(
      `SELECT update_trip(
        ${jsonExpression([ownerId])}->>0,
        (${jsonExpression([tripId])}->>0)::uuid,
        (${jsonExpression([expectedVersion])}->>0)::integer,
        ${jsonExpression(patch)}
      )::text`,
    );
  }

  async transition(ownerId, tripId, expectedVersion, targetStatus) {
    return this.#json(
      `SELECT transition_trip(
        ${jsonExpression([ownerId])}->>0,
        (${jsonExpression([tripId])}->>0)::uuid,
        (${jsonExpression([expectedVersion])}->>0)::integer,
        ${jsonExpression([targetStatus])}->>0
      )::text`,
    );
  }

  async listAudit(ownerId, tripId) {
    return this.#json(
      `SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'auditId', a.audit_id,
            'tripId', a.trip_id,
            'ownerId', a.owner_id,
            'action', a.action,
            'version', a.version,
            'changes', a.changes,
            'createdAt', to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          )
          ORDER BY a.audit_id
        ),
        '[]'::jsonb
      )::text
      FROM trip_audit a
      WHERE a.owner_id = ${jsonExpression([ownerId])}->>0
        AND a.trip_id = (${jsonExpression([tripId])}->>0)::uuid`,
    );
  }

  async #json(sql) {
    const args = [this.databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-At"];
    args.push("-c", sql);
    try {
      const { stdout } = await execFileAsync(this.psqlBin, args, {
        maxBuffer: 2 * 1024 * 1024,
      });
      const output = stdout.trim();
      return JSON.parse(output || "null");
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
