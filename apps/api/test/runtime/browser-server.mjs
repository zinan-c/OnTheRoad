import { startApi } from "../../dist/main.js";

const required = [
  "DATABASE_URL",
  "REDIS_URL",
  "OBJECT_STORAGE_ENDPOINT",
  "OBJECT_STORAGE_ACCESS_KEY",
  "OBJECT_STORAGE_SECRET_KEY",
  "OBJECT_STORAGE_BUCKET",
  "CLAMAV_HOST",
  "CLAMAV_PORT",
  "SESSION_SECRET",
];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  throw new Error(
    `Real browser API server is missing required environment: ${missing.join(", ")}`,
  );
}

const started = await startApi({
  ...process.env,
  NODE_ENV: "development",
  APP_ORIGIN: "http://127.0.0.1:3000",
  API_BASE_URL: "http://127.0.0.1:3001/api/v1",
  API_HOST: "127.0.0.1",
  API_PORT: "3001",
  MAP_PROFILE: "fixture",
  MAP_AUTOCOMPLETE_ENABLED: "false",
  MAP_EXPLICIT_SEARCH_ENABLED: "false",
});

async function close() {
  await started.close();
  process.exit(0);
}

process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
