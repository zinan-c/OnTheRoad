import { defineConfig, devices } from "@playwright/test";

const webOrigin = process.env.OTR_PLAYWRIGHT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const webPort = Number(new URL(webOrigin).port);
const e2eMode = process.env.OTR_E2E_MODE === "1";
const e2eWriteToken = process.env.OTR_E2E_WRITE_TOKEN
  ?? "e2e-local-write-token-change-per-run-123456";

if (e2eMode && e2eWriteToken.length < 32) {
  throw new Error("E2E mode requires OTR_E2E_WRITE_TOKEN with at least 32 characters.");
}

export default defineConfig({
  testDir: ".",
  testMatch: ["browser/**/*.spec.ts", "e2e/**/*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  ...(e2eMode ? { globalSetup: "../../tests/e2e/global-setup.ts" } : {}),
  use: {
    baseURL: webOrigin,
    trace: "retain-on-failure",
    ...(e2eMode ? {
      extraHTTPHeaders: { "x-otr-e2e-write-token": e2eWriteToken },
      storageState: process.env.OTR_PRODUCT_E2E_STORAGE_STATE
        ?? "test-results/required-e2e-storage-state.json",
    } : {}),
  },
  webServer: {
    command: process.env.OTR_PLAYWRIGHT_PREBUILT === "1"
      ? "pnpm --filter @on-the-road/web start"
      : "pnpm --filter @on-the-road/web build && pnpm --filter @on-the-road/web start",
    cwd: "../..",
    port: webPort,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { PORT: String(webPort) },
  },
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
