import { pathToFileURL } from "node:url";

import { loadProcessConfig } from "@on-the-road/config/env";
import { createPdfQueueProcess } from "./queue-runtime.js";

export async function startPdfWorker(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const config = loadProcessConfig("pdf-worker", environment);
  if (!config.server) throw new Error("PDF Worker server configuration is required.");
  const processRuntime = createPdfQueueProcess({
    redisUrl: config.server.redisUrl.href,
  });
  const close = () => processRuntime.close();
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
  return { processRuntime, close };
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  await startPdfWorker();
}
