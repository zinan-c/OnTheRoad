import { describe, expect, test } from "vitest";

import { Redis } from "ioredis";

import { PostgresExecutor } from "../../../packages/database/src/postgres/index.js";
import { startWorker } from "../../../apps/worker/src/main.js";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const minioUrl = process.env.OBJECT_STORAGE_ENDPOINT;
const apiUrl = process.env.API_BASE_URL;
const webUrl = process.env.APP_ORIGIN;


function required(name: string, value: string | undefined): string {
  if (!value?.trim()) throw new Error(`M3 real environment requires ${name}. Run through a dev or qa profile.`);
  return value;
}

describe("M3 real Postgres/Redis/MinIO/Web/API/Worker environment", () => {
  test("Postgres is reachable with the selected profile credentials", async () => {
    const database = new PostgresExecutor({
      databaseUrl: required("DATABASE_URL", databaseUrl),
      role: "test",
    });
    try {
      const postgres = await database.query<{ one: number }>("SELECT 1 AS one");
      expect(postgres.rows[0]?.one).toBe(1);
    } finally {
      await database.close();
    }
  });

  test("Redis is reachable with the selected profile credentials", async () => {
    const redis = new Redis(required("REDIS_URL", redisUrl), { maxRetriesPerRequest: null });
    try {
      await expect(redis.ping()).resolves.toBe("PONG");
    } finally {
      redis.disconnect();
    }
  });

  test("MinIO is reachable through the selected profile endpoint", async () => {
    const minio = await fetch(new URL("/minio/health/ready", required("OBJECT_STORAGE_ENDPOINT", minioUrl)));
    expect(minio.status).toBe(200);
  });

  test("API readiness is reachable through the selected profile endpoint", async () => {
    const apiOrigin = new URL(required("API_BASE_URL", apiUrl)).origin;
    const api = await fetch(new URL("/health/ready", apiOrigin));
    expect(api.status).toBe(200);
    await expect(api.json()).resolves.toMatchObject({ status: "ready" });
  });

  test("Web is reachable through the selected profile endpoint", async () => {
    const web = await fetch(required("APP_ORIGIN", webUrl));
    expect(web.status).toBe(200);
  });

  test("the real Worker starts against the selected profile Redis", async () => {
    const worker = await startWorker(process.env);
    try {
      expect(worker.processRuntime.queueName).toBe("otr.application");
    } finally {
      await worker.close();
    }
  });
});
