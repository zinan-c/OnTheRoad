import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { PostgresOutboxStore } from "../../../apps/api/src/modules/jobs/postgres-outbox-store.mjs";
import { RedisCliJobQueue } from "../../../apps/worker/src/processors/maintenance/redis-cli-job-queue.mjs";
import { OutboxReconciler } from "../../../apps/worker/src/processors/maintenance/outbox-reconciler.js";
import {
  InMemoryTelemetrySink,
  acceptRequestContext,
  createOutboxTelemetryEnvelope,
  createTelemetry,
  restoreWorkerContext,
} from "../../../packages/observability/src/index.js";
import { S3ObjectStorage } from "../../../packages/storage/src/index.js";
import {
  startNativeMinio,
  type NativeMinio,
} from "../../../packages/storage/test/native-minio.js";
import {
  databaseUrl,
  prepareJobsDatabase,
  redisUrl,
} from "./native-harness.mjs";

const nativeTest = databaseUrl && redisUrl ? test : test.skip;
const eventId = `m1-event-${randomUUID()}`;
const namespace = `otr:m1:${randomUUID()}`;
let outbox: PostgresOutboxStore;
let queue: RedisCliJobQueue;
let minio: NativeMinio | undefined;

describe("TC-M1-INT-02 platform recovery integration", () => {
  beforeAll(async () => {
    await prepareJobsDatabase();
    if (!databaseUrl || !redisUrl) return;
    outbox = new PostgresOutboxStore({ databaseUrl });
    queue = new RedisCliJobQueue({ redisUrl, namespace });
    await queue.clear();
  });

  afterAll(async () => {
    await minio?.stop();
    if (queue) await queue.clear();
    if (outbox) await outbox.remove(eventId);
  });

  nativeTest(
    "recovers once after publish loss, preserves objects, and links API/worker traces",
    async () => {
      const apiContext = acceptRequestContext({ "x-request-id": `request-${eventId}` });
      const envelope = createOutboxTelemetryEnvelope(apiContext, {
        eventId,
        eventType: "trip.updated",
      });
      const apiSink = new InMemoryTelemetrySink();
      createTelemetry({ serviceName: "api", sinks: [apiSink] }).span(
        "outbox.committed",
        { context: apiContext, attributes: { eventId } },
      );

      await outbox.appendOutboxEvent({
        eventId,
        eventType: envelope.payload.eventType,
        aggregateId: `trip-${randomUUID()}`,
        aggregateType: "trip",
        aggregateVersion: 1,
        schemaVersion: 1,
      });

      // Simulate a process death after PostgreSQL commit, before queue publish,
      // followed by total Redis delivery-state loss.
      await queue.clear();
      const reconciler = new OutboxReconciler(outbox, queue);
      const recovered = await reconciler.reconcile();
      expect(recovered.enqueued).toBeGreaterThanOrEqual(1);
      expect((await queue.events()).filter((event) => event.eventId === eventId)).toHaveLength(1);

      const secondPass = await reconciler.reconcile();
      expect(secondPass.enqueued).toBe(0);
      expect((await queue.events()).filter((event) => event.eventId === eventId)).toHaveLength(1);

      const workerContext = restoreWorkerContext(envelope, eventId);
      const workerSink = new InMemoryTelemetrySink();
      createTelemetry({ serviceName: "worker", sinks: [workerSink] }).span(
        "job.restored",
        { context: workerContext, attributes: { eventId } },
      );
      expect(workerContext.traceId).toBe(apiContext.traceId);
      expect(apiSink.entries[0]?.context?.traceId).toBe(
        workerSink.entries[0]?.context?.traceId,
      );
      expect(workerContext.spanId).not.toBe(apiContext.spanId);

      minio = await startNativeMinio();
      const storage = new S3ObjectStorage({
        endpoint: minio.endpoint,
        region: "local",
        bucket: minio.bucket,
        accessKey: minio.accessKey,
        secretKey: minio.secretKey,
        keyFactory: () => "m1-gate-object",
      });
      const body = Buffer.from("M1 immutable attachment");
      const checksumSha256 = createHash("sha256").update(body).digest("base64");
      const upload = storage.createUploadSession({
        ownerId: eventId,
        contentType: "image/png",
        contentLength: body.length,
        checksumSha256,
      });
      expect((await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: upload.headers,
        body,
      })).status).toBe(200);
      const original = await storage.inspectObject(upload.objectKey);
      expect((await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: upload.headers,
        body,
      })).status).toBe(412);
      expect(await storage.inspectObject(upload.objectKey)).toEqual(original);
      expect(original.objectVersion).toBeTruthy();
    },
    30_000,
  );
});
