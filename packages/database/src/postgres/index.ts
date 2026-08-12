import pg, {
  type Pool as PgPool,
  type PoolClient,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";

export type { PoolClient } from "pg";

const { Pool } = pg;

export type DatabaseProcessRole = "api" | "worker" | "migration" | "test";

const ROLE_MAX_CONNECTIONS: Readonly<Record<DatabaseProcessRole, number>> = {
  api: 10,
  worker: 4,
  migration: 2,
  test: 2,
};

export class PostgresRuntimeError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(
    code: string,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "PostgresRuntimeError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.cause = options.cause;
  }
}

export function createPostgresPool(options: {
  databaseUrl: string;
  role: DatabaseProcessRole;
  maxConnections?: number;
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
  idleTransactionTimeoutMs?: number;
  statementTimeoutMs?: number;
  queryTimeoutMs?: number;
  overrides?: PoolConfig;
}): PgPool {
  if (!options.databaseUrl) throw new TypeError("databaseUrl is required");
  const max = options.maxConnections ?? ROLE_MAX_CONNECTIONS[options.role];
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError("maxConnections must be a positive integer");
  }
  return new Pool({
    connectionString: options.databaseUrl,
    application_name: `on-the-road-${options.role}`,
    max,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    idleTimeoutMillis: options.idleTimeoutMs ?? 10_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    query_timeout: options.queryTimeoutMs ?? 20_000,
    options: `-c idle_in_transaction_session_timeout=${
      options.idleTransactionTimeoutMs ?? 15_000
    }`,
    allowExitOnIdle: options.role === "test",
    ...options.overrides,
  });
}

export class PostgresExecutor {
  readonly pool: PgPool;
  readonly #ownsPool: boolean;
  readonly #queryTimeoutMs: number;
  readonly #maximumQueuedQueries: number;
  readonly #shutdownTimeoutMs: number;
  #closed = false;

  constructor(options: {
    pool?: PgPool | undefined;
    databaseUrl?: string | undefined;
    role?: DatabaseProcessRole;
    maxConnections?: number;
    maximumQueuedQueries?: number;
    queryTimeoutMs?: number;
    shutdownTimeoutMs?: number;
  }) {
    const role = options.role ?? "api";
    this.#queryTimeoutMs = options.queryTimeoutMs ?? 20_000;
    this.#maximumQueuedQueries =
      options.maximumQueuedQueries ?? (options.maxConnections ?? ROLE_MAX_CONNECTIONS[role]);
    this.#shutdownTimeoutMs = options.shutdownTimeoutMs ?? 10_000;
    this.#ownsPool = !options.pool;
    this.pool = options.pool ?? createPostgresPool({
      databaseUrl: options.databaseUrl ?? "",
      role,
      ...(options.maxConnections === undefined
        ? {}
        : { maxConnections: options.maxConnections }),
      queryTimeoutMs: this.#queryTimeoutMs,
    });
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.#assertAvailable();
    try {
      return await this.pool.query<Row>(text, [...values]);
    } catch (error) {
      throw normalizePostgresRuntimeError(error);
    }
  }

  async json<Result>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<Result> {
    const result = await this.query(text, values);
    const row = result.rows[0];
    if (!row) return null as Result;
    const value = Object.values(row)[0];
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as Result;
      } catch (error) {
        throw new PostgresRuntimeError(
          "DATABASE_RESULT_INVALID",
          "Database returned invalid JSON.",
          { cause: error },
        );
      }
    }
    return value as Result;
  }

  async transaction<Result>(
    operation: (client: PoolClient) => Promise<Result>,
  ): Promise<Result> {
    this.#assertAvailable();
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original transaction failure.
        }
      }
      throw normalizePostgresRuntimeError(error);
    } finally {
      client?.release();
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (!this.#ownsPool) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.pool.end(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new PostgresRuntimeError(
              "DATABASE_SHUTDOWN_TIMEOUT",
              "Database pool did not close before the shutdown deadline.",
              { retryable: false },
            ));
          }, this.#shutdownTimeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  #assertAvailable(): void {
    if (this.#closed) {
      throw new PostgresRuntimeError(
        "DATABASE_POOL_CLOSED",
        "Database pool is closed.",
      );
    }
    if (
      this.pool.idleCount === 0
      && this.pool.waitingCount >= this.#maximumQueuedQueries
    ) {
      throw new PostgresRuntimeError(
        "DATABASE_POOL_EXHAUSTED",
        "Database request queue is full.",
        { retryable: true },
      );
    }
  }
}

export function postgresErrorIdentity(error: unknown): {
  code?: string;
  constraint?: string;
  message?: string;
} {
  const current = error instanceof PostgresRuntimeError && error.cause
    ? error.cause
    : error;
  if (typeof current !== "object" || current === null) return {};
  return {
    ...("code" in current && typeof current.code === "string"
      ? { code: current.code }
      : {}),
    ...("constraint" in current && typeof current.constraint === "string"
      ? { constraint: current.constraint }
      : {}),
    ...("message" in current && typeof current.message === "string"
      ? { message: current.message }
      : {}),
  };
}

export function normalizePostgresRuntimeError(error: unknown): Error {
  if (error instanceof PostgresRuntimeError) return error;
  const identity = postgresErrorIdentity(error);
  if (identity.code === "57014") {
    return new PostgresRuntimeError(
      "DATABASE_QUERY_TIMEOUT",
      "Database query timed out.",
      { retryable: true, cause: error },
    );
  }
  if (identity.code === "53300") {
    return new PostgresRuntimeError(
      "DATABASE_CONNECTION_EXHAUSTED",
      "Database connection limit was reached.",
      { retryable: true, cause: error },
    );
  }
  return new PostgresRuntimeError(
    "DATABASE_QUERY_FAILED",
    "Database query failed.",
    { retryable: true, cause: error },
  );
}
