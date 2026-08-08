import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";

import { loadProcessConfig } from "@on-the-road/config/env";
import { PostgresEventProcessor } from "./processors/maintenance/postgres-event-processor.js";
import { APPLICATION_QUEUE, createQueueProcess } from "./queue-runtime.js";
import { Redis } from "ioredis";
import { IMPORT_CONTENT_TYPES, S3ObjectStorage } from "@on-the-road/storage";
import { ClamAvTcpScanner } from "./processors/media/clamav-scanner.js";
import { IsolatedWorkbookInspector } from "./processors/import/isolated-inspector.js";
import { ImportInspectProcessor } from "./processors/import/inspect.js";
import { WorkbookSourceScanProcessor } from "./processors/import/source-scan.js";
import { PostgresImportInspectRepository } from "./processors/import/postgres-repository.js";
import { PostgresImportStagingProcessor } from "./processors/import/postgres-staging-processor.js";
import { ImageMagickProcessor } from "./processors/media/imagemagick-processor.js";
import { MediaPipeline } from "./processors/media/media-pipeline.js";
import { PostgresMediaRepository } from "./processors/media/postgres-media-repository.mjs";
import { OutboxReconciler } from "./processors/maintenance/outbox-reconciler.js";
import { PostgresRecoverableOutbox } from "./processors/maintenance/postgres-outbox-repository.js";
import { recordWorkerPipeline, workerTelemetry } from "./telemetry.js";

export async function startWorker(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const config = loadProcessConfig("worker", environment);
  if (!config.server) throw new Error("Worker server configuration is required.");
  const eventProcessor = new PostgresEventProcessor(
    config.server.databaseUrl.href,
  );
  const processRuntime = createQueueProcess({
    redisUrl: config.server.redisUrl.href,
    processor: (job) => eventProcessor.process(job),
  });
  const workRedis = new Redis(config.server.redisUrl.href, {
    maxRetriesPerRequest: null,
  });
  const controlRedis = new Redis(config.server.redisUrl.href);
  const importRepository = new PostgresImportInspectRepository(config.server.databaseUrl.href);
  const staging = new PostgresImportStagingProcessor(config.server.databaseUrl.href);
  const importStorage = new S3ObjectStorage({
    endpoint: config.server.storage.endpoint.href,
    region: environment.OBJECT_STORAGE_REGION?.trim() || "us-east-1",
    bucket: config.server.storage.bucket,
    accessKey: config.server.storage.accessKey,
    secretKey: config.server.storage.secretKey,
    allowedContentTypes: IMPORT_CONTENT_TYPES,
  });
  const scanner = new ClamAvTcpScanner({ host: config.server.clamav.host, port: config.server.clamav.port });
  const sourceScan = new WorkbookSourceScanProcessor({ repository: importRepository, storage: { readImmutable: (key, version) => importStorage.readQuarantine(key, version) }, scanner: { name: "clamav", scan: scanner.scan.bind(scanner) } });
  const inspector = new IsolatedWorkbookInspector({ timeoutMs: 10_000 });
  const inspect = new ImportInspectProcessor({ repository: importRepository, storage: { readImmutable: (key, version) => importStorage.readQuarantine(key, version) }, inspect: inspector.inspect.bind(inspector) });
  const mediaStorage = new S3ObjectStorage({
    endpoint: config.server.storage.endpoint.href,
    region: environment.OBJECT_STORAGE_REGION?.trim() || "us-east-1",
    bucket: config.server.storage.bucket,
    accessKey: config.server.storage.accessKey,
    secretKey: config.server.storage.secretKey,
  });
  const mediaRepository = new PostgresMediaRepository({
    databaseUrl: config.server.databaseUrl.href,
  });
  const media = new MediaPipeline({
    repository: mediaRepository,
    storage: mediaStorage,
    scanner,
    imageProcessor: new ImageMagickProcessor(),
  });
  let importing = true;
  const importLoop = (async () => {
    while (importing) {
      const result = await workRedis.brpop(
        "otr:import-inspect",
        "otr:import-stage",
        "otr:media",
        1,
      );
      if (!result) continue;
      const startedAt = performance.now();
      let outcome: "succeeded" | "failed" = "succeeded";
      let errorCode: string | undefined;
      try {
        const payload = JSON.parse(result[1]) as {
          jobId?: string;
          attachmentId?: string;
        };
        if (result[0] === "otr:import-inspect" && payload.jobId) {
          const job = await importRepository.getJob(payload.jobId);
          const attachment = await importRepository.getAttachment(job.attachmentId);
          if (attachment.status === "uploaded") await sourceScan.process(job.attachmentId);
          await inspect.process(payload.jobId);
        } else if (result[0] === "otr:import-stage" && payload.jobId) {
          await staging.process(payload.jobId);
        } else if (result[0] === "otr:media" && payload.attachmentId) {
          await media.process(payload.attachmentId);
        }
      } catch (error) {
        outcome = "failed";
        errorCode = error instanceof Error ? error.name : "UnknownError";
      } finally {
        recordWorkerPipeline(workerTelemetry, {
          queue: result[0],
          outcome,
          durationMs: performance.now() - startedAt,
          ...(errorCode ? { errorCode } : {}),
        });
      }
    }
  })();

  const outbox = new PostgresRecoverableOutbox(config.server.databaseUrl.href);
  const queueConnection = new Redis(config.server.redisUrl.href, {
    maxRetriesPerRequest: null,
  });
  const applicationQueue = new Queue(APPLICATION_QUEUE, {
    connection: queueConnection,
  });
  const reconciler = new OutboxReconciler(outbox, {
    async has(eventId) {
      return Boolean(await applicationQueue.getJob(eventId));
    },
    async add(event) {
      await applicationQueue.add(event.eventType, event, {
        jobId: event.eventId,
        removeOnComplete: false,
      });
    },
  });
  let reconciling = false;
  const reconcile = async () => {
    if (reconciling) return;
    reconciling = true;
    try {
      await reconciler.reconcile();
      for (const jobId of await staging.listRecoverableJobIds()) {
        if (await controlRedis.set(`otr:recovery:import-stage:${jobId}`, "1", "EX", 60, "NX")) {
          await controlRedis.lpush("otr:import-stage", JSON.stringify({ jobId }));
        }
      }
      for (const attachmentId of await mediaRepository.listRecoverableAttachmentIds()) {
        if (await controlRedis.set(`otr:recovery:media:${attachmentId}`, "1", "EX", 60, "NX")) {
          await controlRedis.lpush("otr:media", JSON.stringify({ attachmentId }));
        }
      }
    } finally {
      reconciling = false;
    }
  };
  await applicationQueue.waitUntilReady();
  await reconcile();
  const reconciliationTimer = setInterval(() => void reconcile(), 1_000);
  const heartbeatKey = `otr:worker:heartbeat:${randomUUID()}`;
  const heartbeat = async () => {
    await controlRedis.set(heartbeatKey, new Date().toISOString(), "EX", 15);
  };
  await heartbeat();
  const heartbeatTimer = setInterval(() => void heartbeat(), 5_000);
  const close = async () => {
    importing = false;
    clearInterval(heartbeatTimer);
    clearInterval(reconciliationTimer);
    await controlRedis.del(heartbeatKey).catch(() => undefined);
    workRedis.disconnect();
    controlRedis.disconnect();
    await importLoop.catch(() => undefined);
    await importRepository.close();
    await staging.close();
    await mediaRepository.close();
    await applicationQueue.close();
    queueConnection.disconnect();
    await outbox.close();
    await processRuntime.close();
    await eventProcessor.close();
  };
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
  return { processRuntime, close };
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  await startWorker();
}
