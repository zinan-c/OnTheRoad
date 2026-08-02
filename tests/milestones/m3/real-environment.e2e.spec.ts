import { afterAll, describe, expect, test } from "vitest";

import { Redis } from "ioredis";

import { PostgresExecutor } from "../../../packages/database/src/postgres/index.js";

const databaseUrl = process.env.OTR_M3_DATABASE_URL;
const redisUrl = process.env.OTR_M3_REDIS_URL;
const minioUrl = process.env.OTR_M3_MINIO_URL;
const apiUrl = process.env.OTR_M3_API_URL;
const webUrl = process.env.OTR_M3_WEB_URL;
const workerHeartbeatKey = process.env.OTR_M3_WORKER_HEARTBEAT_KEY;
const enabled = Boolean(
  databaseUrl
  && redisUrl
  && minioUrl
  && apiUrl
  && webUrl
  && workerHeartbeatKey,
);
const liveTest = enabled ? test : test.skip;

let database: PostgresExecutor | undefined;
let redis: Redis | undefined;

afterAll(async () => {
  await database?.close();
  redis?.disconnect();
});

describe("M3 real Postgres/Redis/MinIO/Web/API/Worker environment", () => {
  liveTest(
    "probes every runtime dependency and requires a live worker heartbeat",
    async () => {
      database = new PostgresExecutor({ databaseUrl, role: "test" });
      redis = new Redis(redisUrl!, { maxRetriesPerRequest: null });

      const postgres = await database.query<{ one: number }>("SELECT 1 AS one");
      expect(postgres.rows[0]?.one).toBe(1);
      await expect(redis.ping()).resolves.toBe("PONG");

      const minio = await fetch(new URL("/minio/health/ready", minioUrl));
      expect(minio.status).toBe(200);

      const api = await fetch(new URL("/health/ready", apiUrl));
      expect(api.status).toBe(200);
      await expect(api.json()).resolves.toMatchObject({ status: "ready" });

      const web = await fetch(webUrl!);
      expect(web.status).toBe(200);

      const heartbeat = await redis.get(workerHeartbeatKey!);
      expect(heartbeat).toBeTruthy();
    },
  );
});
