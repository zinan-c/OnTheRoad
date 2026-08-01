import { randomInt, randomUUID } from "node:crypto";

import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { PostgresExecutor } from "../../packages/database/src/postgres/index.js";
import { OnTheRoadClient } from "../../packages/contracts/src/generated/index.mjs";
import { startApi, type StartedApi } from "../../apps/api/src/main.js";
import { PostgresEventProcessor } from "../../apps/worker/src/processors/maintenance/postgres-event-processor.js";
import {
  APPLICATION_QUEUE,
  createQueueProcess,
  type QueueProcess,
} from "../../apps/worker/src/queue-runtime.js";

const databaseUrl = process.env.OTR_RUNTIME_SMOKE_DATABASE_URL;
const redisUrl = process.env.OTR_RUNTIME_SMOKE_REDIS_URL;
const enabled = Boolean(databaseUrl && redisUrl);
const integrationTest = enabled ? test : test.skip;

let database: PostgresExecutor;
let api: StartedApi;
let eventProcessor: PostgresEventProcessor;
let worker: QueueProcess;
let queue: Queue;
let queueConnection: Redis;
let eventId: string | undefined;
let tripId: string | undefined;

function runtimeEnvironment(): Record<string, string> {
  const apiPort = randomInt(20_000, 40_000);
  return {
    NODE_ENV: "development",
    APP_ORIGIN: "http://127.0.0.1:3000",
    API_BASE_URL: `http://127.0.0.1:${apiPort}/api/v1`,
    API_HOST: "127.0.0.1",
    API_PORT: String(apiPort),
    DATABASE_URL: databaseUrl!,
    REDIS_URL: redisUrl!,
    OBJECT_STORAGE_ENDPOINT:
      process.env.OTR_RUNTIME_SMOKE_STORAGE_ENDPOINT ?? "http://127.0.0.1:19000",
    OBJECT_STORAGE_ACCESS_KEY: "runtime-smoke-access",
    OBJECT_STORAGE_SECRET_KEY: "runtime-smoke-secret",
    OBJECT_STORAGE_BUCKET: "runtime-smoke",
    CLAMAV_HOST: "127.0.0.1",
    CLAMAV_PORT: process.env.OTR_RUNTIME_SMOKE_CLAMAV_PORT ?? "13310",
    SESSION_SECRET: "runtime-smoke-session-secret-at-least-32-bytes",
    MAP_PROFILE: "fixture",
    MAP_AUTOCOMPLETE_ENABLED: "false",
    MAP_EXPLICIT_SEARCH_ENABLED: "false",
  };
}

async function eventually(
  assertion: () => Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Runtime smoke condition did not become true before timeout.");
}

beforeAll(async () => {
  if (!enabled) return;
  database = new PostgresExecutor({ databaseUrl, role: "test" });
  api = await startApi(runtimeEnvironment());
  const queueName = `${APPLICATION_QUEUE}.runtime-smoke.${randomUUID()}`;
  eventProcessor = new PostgresEventProcessor(databaseUrl!);
  worker = createQueueProcess({
    redisUrl: redisUrl!,
    queueName,
    processor: (job) => eventProcessor.process(job),
  });
  queueConnection = new Redis(redisUrl!, { maxRetriesPerRequest: null });
  queue = new Queue(queueName, { connection: queueConnection });
  await queue.waitUntilReady();
});

afterAll(async () => {
  if (!enabled) return;
  if (eventId) {
    await database.query(
      "DELETE FROM job_inbox WHERE event_id = $1",
      [eventId],
    );
    await database.query(
      "DELETE FROM job_outbox WHERE event_id = $1",
      [eventId],
    );
  }
  if (tripId) {
    await database.query("DELETE FROM trip WHERE id = $1::uuid", [tripId]);
  }
  await queue?.obliterate({ force: true });
  await queue?.close();
  queueConnection?.disconnect();
  await worker?.close();
  await eventProcessor?.close();
  await api?.close();
  await database?.close();
});

describe("REVIEW-P0-01 real API/DB/queue/Worker smoke", () => {
  integrationTest(
    "starts from migrated PostgreSQL and persists an HTTP edit through Worker consumption",
    async () => {
      const baseUrl = await api.app.getUrl();
      const loginResponse = await fetch(
        `${baseUrl}/api/v1/identity/development-session`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://127.0.0.1:3000",
          },
          body: JSON.stringify({ subject: `runtime-smoke-${randomUUID()}` }),
        },
      );
      expect(loginResponse.status).toBe(201);
      const sessionCookie = loginResponse.headers.getSetCookie()[0]?.split(";", 1)[0];
      expect(sessionCookie).toContain("__Host-otr_session=");
      const authenticatedFetch: typeof fetch = (input, init) =>
        fetch(input, {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers).entries()),
            cookie: sessionCookie!,
          },
        });
      const client = new OnTheRoadClient(baseUrl, {
        fetch: authenticatedFetch,
      });
      const trip = await client.createTrip({
        name: "Runtime smoke trip",
        startDate: "2026-10-01",
        endDate: "2026-10-05",
        travelers: 2,
        defaultCurrency: "CNY",
        timezone: "Asia/Shanghai",
        mapProfile: "cn_primary",
        destinations: [{ name: "上海", countryCode: "CN" }],
      }, `runtime-smoke-${randomUUID()}`);
      tripId = trip.data.id;
      const day = await database.query<{ id: string }>(
        `SELECT id
         FROM trip_day
         WHERE trip_id = $1::uuid
         ORDER BY day_number
         LIMIT 1`,
        [tripId],
      );
      const tripDayId = day.rows[0]!.id;
      const first = await client.createItineraryItem(tripId, tripDayId, {
        itemType: "attraction",
        timeKind: "period",
        timePeriod: "morning",
        target: "外滩",
      });
      const second = await client.createItineraryItem(tripId, tripDayId, {
        itemType: "dining",
        timeKind: "period",
        timePeriod: "afternoon",
        target: "午餐",
      });

      const locationResponse = await authenticatedFetch(
        `${baseUrl}/api/v1/trips/${tripId}/locations`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ inputText: "上海外滩" }),
        },
      );
      expect(locationResponse.status).toBe(201);
      const location = await locationResponse.json() as { id: string; version: number };
      const confirmation = await authenticatedFetch(
        `${baseUrl}/api/v1/trips/${tripId}/locations/${location.id}/coordinates`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "if-match": String(location.version),
          },
          body: JSON.stringify({
            longitude: 121.49002,
            latitude: 31.24001,
          }),
        },
      );
      expect(confirmation.status).toBe(200);

      const upload = await client.request("createAttachmentUploadSession", {
        path: { tripId },
        headers: { "idempotency-key": `upload-${randomUUID()}` },
        body: {
          filename: "arrival.jpg",
          contentType: "image/jpeg",
          contentLength: 1,
          checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        },
      });
      expect(upload.data).toMatchObject({ attachmentId: expect.any(String) });

      await client.reorderItineraryItems(
        tripId,
        tripDayId,
        1,
        [second.data.id, first.data.id],
      );
      const event = await database.query<{
        event_id: string;
        event_type: string;
        aggregate_id: string;
        aggregate_type: string;
        aggregate_version: string;
        schema_version: number;
      }>(
        `SELECT event_id, event_type, aggregate_id, aggregate_type,
                aggregate_version, schema_version
         FROM job_outbox
         WHERE event_type = 'itinerary.order.changed'
           AND aggregate_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [tripDayId],
      );
      const row = event.rows[0]!;
      eventId = row.event_id;
      await queue.add(row.event_type, {
        eventId: row.event_id,
        eventType: row.event_type,
        aggregateId: row.aggregate_id,
        aggregateType: row.aggregate_type,
        aggregateVersion: Number(row.aggregate_version),
        schemaVersion: row.schema_version,
      }, {
        jobId: row.event_id,
        removeOnComplete: false,
      });
      await eventually(async () => {
        const result = await database.query<{ handled: boolean }>(
          `SELECT handled_at IS NOT NULL AS handled
           FROM job_outbox
           WHERE event_id = $1`,
          [eventId],
        );
        return result.rows[0]?.handled === true;
      });
      const inbox = await database.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM job_inbox
         WHERE consumer_name = 'application-worker'
           AND event_id = $1`,
        [eventId],
      );
      expect(inbox.rows[0]?.count).toBe("1");

      const reloaded = await client.getTrip(tripId);
      expect(reloaded.data.name).toBe("Runtime smoke trip");
    },
    30_000,
  );
});
