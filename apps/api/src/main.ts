import "reflect-metadata";

import { pathToFileURL } from "node:url";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { createApiApplication } from "./app.js";
import { createProductionRuntime, type ApiRuntime } from "./runtime.js";

export interface StartedApi {
  readonly app: NestFastifyApplication;
  readonly runtime: ApiRuntime;
  close(): Promise<void>;
}

export async function startApi(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<StartedApi> {
  const runtime = createProductionRuntime(environment);
  const app = await createApiApplication(runtime);
  const port = Number(environment.API_PORT ?? 3001);
  const host = environment.API_HOST?.trim() || "0.0.0.0";
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    await runtime.close();
  };
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
  try {
    await app.listen(port, host);
  } catch (error) {
    await close();
    throw error;
  }
  return { app, runtime, close };
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  await startApi();
}
