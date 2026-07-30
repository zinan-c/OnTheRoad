import { describe, expect, test, vi } from "vitest";

import {
  createPostgresPool,
  PostgresExecutor,
  PostgresRuntimeError,
} from "../src/postgres/index.js";

function poolDouble() {
  const client = {
    query: vi.fn(async () => ({ rows: [] })),
    release: vi.fn(),
  };
  const pool = {
    idleCount: 1,
    waitingCount: 0,
    query: vi.fn(async (_text, values) => ({ rows: [{ value: { values } }] })),
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
  };
  return { client, pool };
}

describe("REVIEW-P1-01 pooled PostgreSQL executor", () => {
  test("binds values and never places credentials in a subprocess", async () => {
    const { pool } = poolDouble();
    const executor = new PostgresExecutor({ pool: pool as never });
    await expect(executor.json("SELECT $1::text", ["business-input"])).resolves.toEqual({
      values: ["business-input"],
    });
    expect(pool.query).toHaveBeenCalledWith(
      "SELECT $1::text",
      ["business-input"],
    );
  });

  test("fails fast when the bounded queue is exhausted", async () => {
    const { pool } = poolDouble();
    pool.idleCount = 0;
    pool.waitingCount = 2;
    const executor = new PostgresExecutor({
      pool: pool as never,
      maximumQueuedQueries: 2,
    });
    await expect(executor.query("SELECT 1")).rejects.toMatchObject({
      code: "DATABASE_POOL_EXHAUSTED",
      retryable: true,
    });
  });

  test("normalizes server-side cancellation as a retryable timeout", async () => {
    const { pool } = poolDouble();
    pool.query.mockRejectedValueOnce(Object.assign(new Error("cancelled"), {
      code: "57014",
    }));
    const executor = new PostgresExecutor({ pool: pool as never });
    await expect(executor.query("SELECT pg_sleep($1)", [30])).rejects.toMatchObject({
      code: "DATABASE_QUERY_TIMEOUT",
      retryable: true,
    });
  });

  test("uses separate bounded defaults and idle transaction timeouts by role", async () => {
    const apiPool = createPostgresPool({
      databaseUrl: "postgresql://local.invalid/db",
      role: "api",
    });
    const workerPool = createPostgresPool({
      databaseUrl: "postgresql://local.invalid/db",
      role: "worker",
    });
    expect(apiPool.options.max).toBe(10);
    expect(workerPool.options.max).toBe(4);
    expect(apiPool.options.options).toContain(
      "idle_in_transaction_session_timeout=15000",
    );
    await Promise.all([apiPool.end(), workerPool.end()]);
  });

  test("allows concurrent work only while the pool queue remains bounded", async () => {
    const { pool } = poolDouble();
    let releaseFirst;
    pool.idleCount = 0;
    pool.query.mockImplementationOnce(() => new Promise((resolve) => {
      releaseFirst = () => resolve({ rows: [{ value: 1 }] });
    }));
    const executor = new PostgresExecutor({
      pool: pool as never,
      maximumQueuedQueries: 1,
    });
    const first = executor.query("SELECT 1");
    pool.waitingCount = 1;
    await expect(executor.query("SELECT 2")).rejects.toMatchObject({
      code: "DATABASE_POOL_EXHAUSTED",
    });
    releaseFirst();
    await expect(first).resolves.toMatchObject({ rows: [{ value: 1 }] });
  });

  test("rolls back and releases a transaction after failure", async () => {
    const { client, pool } = poolDouble();
    const executor = new PostgresExecutor({ pool: pool as never });
    await expect(executor.transaction(async () => {
      throw new Error("operation failed");
    })).rejects.toBeInstanceOf(PostgresRuntimeError);
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "ROLLBACK"]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  test("owned pools close once and reject new work after shutdown", async () => {
    const { pool } = poolDouble();
    const executor = new PostgresExecutor({
      databaseUrl: "postgresql://local.invalid/db",
      role: "test",
    });
    Object.defineProperty(executor, "pool", { value: pool });
    await executor.close();
    await executor.close();
    expect(pool.end).toHaveBeenCalledOnce();
    await expect(executor.query("SELECT 1")).rejects.toMatchObject({
      code: "DATABASE_POOL_CLOSED",
    });
  });

  test("fails shutdown after its bounded deadline", async () => {
    const { pool } = poolDouble();
    pool.end.mockImplementationOnce(() => new Promise(() => undefined));
    const executor = new PostgresExecutor({
      databaseUrl: "postgresql://local.invalid/db",
      role: "test",
      shutdownTimeoutMs: 5,
    });
    Object.defineProperty(executor, "pool", { value: pool });
    await expect(executor.close()).rejects.toMatchObject({
      code: "DATABASE_SHUTDOWN_TIMEOUT",
    });
  });
});
