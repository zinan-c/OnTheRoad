import { pathToFileURL } from "node:url";

import { loadProcessConfig } from "@on-the-road/config/env";
import { PostgresEventProcessor } from "./processors/maintenance/postgres-event-processor.js";
import { createQueueProcess } from "./queue-runtime.js";
import { Redis } from "ioredis";
import { IMPORT_CONTENT_TYPES, S3ObjectStorage } from "@on-the-road/storage";
import { ClamAvTcpScanner } from "./processors/media/clamav-scanner.js";
import { IsolatedWorkbookInspector } from "./processors/import/isolated-inspector.js";
import { ImportInspectProcessor } from "./processors/import/inspect.js";
import { WorkbookSourceScanProcessor } from "./processors/import/source-scan.js";
import { PostgresImportInspectRepository } from "./processors/import/postgres-repository.js";

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
  const importRedis = new Redis(config.server.redisUrl.href, { lazyConnect: true });
  const importRepository = new PostgresImportInspectRepository(config.server.databaseUrl.href);
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
  let importing = true;
  const importLoop = (async () => {
    while (importing) {
      const result = await importRedis.brpop("otr:import-inspect", 1);
      if (!result) continue;
      const { jobId } = JSON.parse(result[1]) as { jobId: string };
      try {
        const job = await importRepository.getJob(jobId);
        const attachment = await importRepository.getAttachment(job.attachmentId);
        if (attachment.status === "uploaded") await sourceScan.process(job.attachmentId);
        await inspect.process(jobId);
      } catch (error) {
        console.error("Import inspection failed", error);
      }
    }
  })();
  const close = async () => {
    importing = false;
    importRedis.disconnect();
    await importRepository.close();
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
