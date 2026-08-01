import { pathToFileURL } from "node:url";

import { loadProcessConfig } from "@on-the-road/config/env";
import { PostgresEventProcessor } from "./processors/maintenance/postgres-event-processor.js";
import { createQueueProcess } from "./queue-runtime.js";

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
  const close = async () => {
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
