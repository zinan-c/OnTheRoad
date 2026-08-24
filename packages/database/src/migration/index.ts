import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import pg, {
  type Pool as PgPool,
  type PoolClient,
  type PoolConfig,
} from "pg";

const { Pool } = pg;
const MIGRATION_FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/u;
const INCLUDE = /^\\ir\s+(.+)$/gmu;
const LOCK_NAME = "on-the-road-schema-migration";
const DEFAULT_HISTORY_TABLE = "otr_schema_migration";

export const minimumCompatibleSchemaVersion = 26;

export interface Migration {
  version: number;
  name: string;
  checksum: string;
  sql: string;
  file: string;
}

export interface MigrationRecord {
  version: number;
  name: string;
  checksum: string;
  status: "applying" | "applied" | "failed";
  startedAt: string;
  appliedAt: string | null;
  errorCode: string | null;
}

export interface MigrationStatus {
  currentVersion: number;
  latestVersion: number;
  minimumCompatibleVersion: number;
  compatible: boolean;
  pending: number[];
  dirty: MigrationRecord[];
  applied: MigrationRecord[];
}

export class DatabaseMigrationError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "DatabaseMigrationError";
    this.code = code;
    this.details = details;
  }
}

export function createDatabasePool(
  connectionString: string,
  overrides: PoolConfig = {},
): PgPool {
  if (!connectionString) {
    throw new DatabaseMigrationError(
      "DATABASE_URL_REQUIRED",
      "DATABASE_URL is required for database migration commands.",
    );
  }
  return new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 5_000,
    statement_timeout: 60_000,
    application_name: "on-the-road-database-migrator",
    ...overrides,
  });
}

export async function discoverMigrations(
  directory = resolve(new URL("../migrations", import.meta.url).pathname),
): Promise<Migration[]> {
  const entries = (await readdir(directory)).filter((entry) => MIGRATION_FILE.test(entry)).sort();
  const migrations = await Promise.all(entries.map(async (entry) => {
    const match = MIGRATION_FILE.exec(entry);
    if (!match) throw new DatabaseMigrationError("MIGRATION_NAME_INVALID", entry);
    const file = resolve(directory, entry);
    const sql = await expandSqlIncludes(file, new Set());
    return {
      version: Number(match[1]),
      name: match[2] ?? "",
      checksum: createHash("sha256").update(sql).digest("hex"),
      sql,
      file,
    };
  }));
  const versions = migrations.map(({ version }) => version);
  if (new Set(versions).size !== versions.length) {
    throw new DatabaseMigrationError(
      "MIGRATION_VERSION_DUPLICATE",
      "Migration versions must be unique.",
    );
  }
  return migrations;
}

export class DatabaseMigrator {
  readonly #pool: PgPool;
  readonly #migrations: readonly Migration[];
  readonly #historyTable: string;
  readonly #minimumCompatibleVersion: number;

  constructor(options: {
    pool: PgPool;
    migrations: readonly Migration[];
    historyTable?: string;
    minimumCompatibleVersion?: number;
  }) {
    this.#pool = options.pool;
    this.#migrations = [...options.migrations].sort((left, right) => left.version - right.version);
    this.#historyTable = validateIdentifier(options.historyTable ?? DEFAULT_HISTORY_TABLE);
    this.#minimumCompatibleVersion =
      options.minimumCompatibleVersion ?? minimumCompatibleSchemaVersion;
  }

  async migrate(options: { recover?: boolean } = {}): Promise<MigrationStatus> {
    const client = await this.#pool.connect();
    try {
      await this.#configure(client);
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [LOCK_NAME]);
      await this.#ensureHistory(client);
      await this.#validateHistory(client);
      const dirty = (await this.#records(client)).filter(({ status }) => status !== "applied");
      if (dirty.length > 0 && !options.recover) {
        throw new DatabaseMigrationError(
          "MIGRATION_RECOVERY_REQUIRED",
          "An incomplete migration exists; inspect status and rerun with --recover.",
          { versions: dirty.map(({ version }) => version) },
        );
      }
      if (options.recover) {
        await client.query(
          `UPDATE ${this.#historyTable}
             SET status = 'failed', error_code = COALESCE(error_code, 'INTERRUPTED')
           WHERE status = 'applying'`,
        );
      }

      const applied = new Set(
        (await this.#records(client))
          .filter(({ status }) => status === "applied")
          .map(({ version }) => version),
      );
      for (const migration of this.#migrations) {
        if (!applied.has(migration.version)) await this.#apply(client, migration);
      }
      return this.status(client);
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_NAME]);
      } finally {
        client.release();
      }
    }
  }

  async status(existingClient?: PoolClient): Promise<MigrationStatus> {
    const client = existingClient ?? await this.#pool.connect();
    try {
      await this.#configure(client);
      await this.#ensureHistory(client);
      await this.#validateHistory(client);
      const records = await this.#records(client);
      const applied = records.filter(({ status }) => status === "applied");
      const dirty = records.filter(({ status }) => status !== "applied");
      const appliedVersions = new Set(applied.map(({ version }) => version));
      const currentVersion = Math.max(0, ...applied.map(({ version }) => version));
      const latestVersion = Math.max(0, ...this.#migrations.map(({ version }) => version));
      return {
        currentVersion,
        latestVersion,
        minimumCompatibleVersion: this.#minimumCompatibleVersion,
        compatible: currentVersion >= this.#minimumCompatibleVersion && dirty.length === 0,
        pending: this.#migrations
          .filter(({ version }) => !appliedVersions.has(version))
          .map(({ version }) => version),
        dirty,
        applied,
      };
    } finally {
      if (!existingClient) client.release();
    }
  }

  async #apply(client: PoolClient, migration: Migration): Promise<void> {
    await client.query(
      `INSERT INTO ${this.#historyTable}
         (version, name, checksum, status, started_at, applied_at, error_code)
       VALUES ($1, $2, $3, 'applying', clock_timestamp(), NULL, NULL)
       ON CONFLICT (version) DO UPDATE
         SET name = EXCLUDED.name,
             checksum = EXCLUDED.checksum,
             status = 'applying',
             started_at = clock_timestamp(),
             applied_at = NULL,
             error_code = NULL`,
      [migration.version, migration.name, migration.checksum],
    );
    try {
      await client.query("BEGIN");
      await client.query(migration.sql);
      await client.query(
        `UPDATE ${this.#historyTable}
            SET status = 'applied', applied_at = clock_timestamp(), error_code = NULL
          WHERE version = $1`,
        [migration.version],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      const errorCode = postgresErrorCode(error);
      await client.query(
        `UPDATE ${this.#historyTable}
            SET status = 'failed', error_code = $2
          WHERE version = $1`,
        [migration.version, errorCode],
      );
      throw new DatabaseMigrationError(
        "MIGRATION_APPLY_FAILED",
        `Migration ${migration.version}_${migration.name} failed.`,
        { version: migration.version, errorCode },
      );
    }
  }

  async #configure(client: PoolClient): Promise<void> {
    await client.query("SET statement_timeout = '60s'");
    await client.query("SET lock_timeout = '10s'");
    await client.query("SET idle_in_transaction_session_timeout = '60s'");
  }

  async #ensureHistory(client: PoolClient): Promise<void> {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${this.#historyTable} (
        version integer PRIMARY KEY CHECK (version > 0),
        name text NOT NULL,
        checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
        status text NOT NULL CHECK (status IN ('applying', 'applied', 'failed')),
        started_at timestamptz NOT NULL,
        applied_at timestamptz,
        error_code text,
        CHECK (
          (status = 'applied' AND applied_at IS NOT NULL AND error_code IS NULL)
          OR status <> 'applied'
        )
      )
    `);
  }

  async #validateHistory(client: PoolClient): Promise<void> {
    const known = new Map(this.#migrations.map((migration) => [migration.version, migration]));
    for (const record of await this.#records(client)) {
      const migration = known.get(record.version);
      if (!migration) {
        throw new DatabaseMigrationError(
          "MIGRATION_VERSION_UNKNOWN",
          `Database contains unknown migration version ${record.version}.`,
        );
      }
      if (migration.checksum !== record.checksum) {
        throw new DatabaseMigrationError(
          "MIGRATION_CHECKSUM_MISMATCH",
          `Checksum mismatch for migration ${record.version}.`,
          { version: record.version },
        );
      }
    }
  }

  async #records(client: PoolClient): Promise<MigrationRecord[]> {
    const result = await client.query<{
      version: number;
      name: string;
      checksum: string;
      status: MigrationRecord["status"];
      started_at: Date;
      applied_at: Date | null;
      error_code: string | null;
    }>(
      `SELECT version, name, checksum, status, started_at, applied_at, error_code
         FROM ${this.#historyTable}
        ORDER BY version`,
    );
    return result.rows.map((row) => ({
      version: row.version,
      name: row.name,
      checksum: row.checksum,
      status: row.status,
      startedAt: row.started_at.toISOString(),
      appliedAt: row.applied_at?.toISOString() ?? null,
      errorCode: row.error_code,
    }));
  }
}

async function expandSqlIncludes(file: string, visited: Set<string>): Promise<string> {
  if (visited.has(file)) {
    throw new DatabaseMigrationError(
      "MIGRATION_INCLUDE_CYCLE",
      `Migration include cycle detected at ${basename(file)}.`,
    );
  }
  visited.add(file);
  const source = await readFile(file, "utf8");
  const expandedParts = [];
  let cursor = 0;
  for (const match of source.matchAll(INCLUDE)) {
    expandedParts.push(source.slice(cursor, match.index));
    const includePath = match[1]?.trim();
    if (!includePath) {
      throw new DatabaseMigrationError("MIGRATION_INCLUDE_INVALID", `Invalid include in ${file}.`);
    }
    expandedParts.push(await expandSqlIncludes(resolve(dirname(file), includePath), visited));
    cursor = (match.index ?? 0) + match[0].length;
  }
  expandedParts.push(source.slice(cursor));
  visited.delete(file);
  return expandedParts.join("\n");
}

function validateIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/u.test(value)) {
    throw new DatabaseMigrationError(
      "MIGRATION_HISTORY_TABLE_INVALID",
      "Migration history table must be a plain lowercase PostgreSQL identifier.",
    );
  }
  return value;
}

function postgresErrorCode(error: unknown): string {
  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && typeof error.code === "string"
  ) {
    return error.code;
  }
  return "MIGRATION_SQL_FAILED";
}
