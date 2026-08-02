import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["browser/**/*.spec.ts", "e2e/**/*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @on-the-road/api build && node apps/api/test/runtime/browser-server.mjs",
      cwd: "../..",
      port: 3001,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        DATABASE_URL: process.env.DATABASE_URL ?? "",
        REDIS_URL: process.env.REDIS_URL ?? "",
        OBJECT_STORAGE_ENDPOINT:
          process.env.OBJECT_STORAGE_ENDPOINT
          ?? process.env.S3_ENDPOINT
          ?? "",
        OBJECT_STORAGE_ACCESS_KEY:
          process.env.OBJECT_STORAGE_ACCESS_KEY
          ?? process.env.S3_ACCESS_KEY
          ?? "",
        OBJECT_STORAGE_SECRET_KEY:
          process.env.OBJECT_STORAGE_SECRET_KEY
          ?? process.env.S3_SECRET_KEY
          ?? "",
        OBJECT_STORAGE_BUCKET:
          process.env.OBJECT_STORAGE_BUCKET
          ?? process.env.MINIO_BUCKET
          ?? "",
        CLAMAV_HOST: process.env.CLAMAV_HOST ?? "",
        CLAMAV_PORT: process.env.CLAMAV_PORT ?? "",
        SESSION_SECRET:
          process.env.SESSION_SECRET
          ?? "browser-e2e-session-secret-at-least-32-bytes",
      },
    },
    {
      command: "pnpm --filter @on-the-road/web build && pnpm --filter @on-the-road/web start",
      cwd: "../..",
      port: 3000,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_ORIGIN: "http://127.0.0.1:3001",
      },
    },
  ],
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
