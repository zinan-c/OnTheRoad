import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

import { Redis } from "ioredis";
import { loadProcessConfig } from "@on-the-road/config/env";
import { PostgresExecutor } from "@on-the-road/database/postgres";
import { IMPORT_CONTENT_TYPES, S3ObjectStorage } from "@on-the-road/storage";
import { PostgresExportJobSource, PostgresExportStageRepository, S3PdfArtifactStore } from "./export-repository.js";
import { createExportQueueProcessor } from "./export-queue-processor.js";
import { PlaywrightPdfPrintRenderer } from "./print-renderer.js";
import { PdfExportProcessor } from "./pdf-processor.js";
import { createPdfQueueProcess } from "./queue-runtime.js";

type RedisControlConnection = Pick<Redis, "connect" | "ping" | "status">;

export async function waitForRedisControl(
  redis: RedisControlConnection,
): Promise<void> {
  if (redis.status === "wait") await redis.connect();
  await redis.ping();
}

export async function startPdfWorker(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const config = loadProcessConfig("pdf-worker", environment);
  if (!config.server) throw new Error("PDF Worker server configuration is required.");
  const database = new PostgresExecutor({ databaseUrl: config.server.databaseUrl.href, role: "worker" });
  const storage = new S3ObjectStorage({
    endpoint: config.server.storage.endpoint.href,
    region: environment.OBJECT_STORAGE_REGION?.trim() || "us-east-1",
    bucket: config.server.storage.bucket,
    accessKey: config.server.storage.accessKey,
    secretKey: config.server.storage.secretKey,
    allowedContentTypes: [...IMPORT_CONTENT_TYPES, "image/jpeg", "image/png", "image/webp", "application/pdf"],
  });
  const stages = new PostgresExportStageRepository(database);
  const exportProcessor = new PdfExportProcessor({
    source: new PostgresExportJobSource(database),
    stages,
    renderer: new PlaywrightPdfPrintRenderer({
      persistMapAsset: async (job, asset) => {
        const stored = await storage.putImmutable(
          `derived/${job.id}/map-${asset.assetId.replaceAll(":", "-")}-${randomUUID()}`,
          Buffer.from(asset.bytes),
          "image/png",
        );
        const objectVersion = stored.version;
        if (!await stages.recordMapAsset(job, {
          assetId: asset.assetId,
          checksumSha256: asset.checksumSha256,
          objectVersion,
          width: asset.width,
          height: asset.height,
        })) {
          await storage.deleteImmutable?.(stored.key, stored.version).catch(() => undefined);
          throw new Error("PDF_MAP_ASSET_FENCED");
        }
        return { objectKey: stored.key, objectVersion };
      },
      deleteMapAsset: (asset) => storage.deleteImmutable?.(asset.objectKey, asset.objectVersion) ?? Promise.resolve(),
    }),
    artifacts: new S3PdfArtifactStore(storage),
    probeFactory: () => ({
      fontsReady: () => true,
      imagesReady: () => true,
      mapsReady: () => true,
    }),
  });
  const processRuntime = createPdfQueueProcess({
    redisUrl: config.server.redisUrl.href,
    processor: createExportQueueProcessor(exportProcessor),
  });
  const controlRedis = new Redis(config.server.redisUrl.href, {
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  await processRuntime.consumer.waitUntilReady?.();
  await waitForRedisControl(controlRedis);
  const heartbeatKey = `otr:pdf-worker:heartbeat:${randomUUID()}`;
  const heartbeat = async () => {
    await controlRedis.set(heartbeatKey, new Date().toISOString(), "EX", 15);
  };
  await heartbeat();
  const heartbeatTimer = setInterval(() => {
    void heartbeat().catch(() => undefined);
  }, 5_000);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeatTimer);
    await controlRedis.del(heartbeatKey).catch(() => undefined);
    controlRedis.disconnect();
    await processRuntime.close();
    await database.close();
  };
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
  return { processRuntime, close };
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  await startPdfWorker();
}
