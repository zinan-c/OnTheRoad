import { defineConfig, devices } from "@playwright/test";

const externalStack = process.env.OTR_PLAYWRIGHT_EXTERNAL_STACK === "1";
const webOrigin = process.env.OTR_PLAYWRIGHT_WEB_ORIGIN ?? "http://127.0.0.1:3100";
const e2eMode = process.env.OTR_E2E_MODE === "1" || !externalStack;
const e2eWriteToken = process.env.OTR_E2E_WRITE_TOKEN
  ?? "e2e-local-write-token-change-per-run-123456";

if (externalStack && process.env.OTR_E2E_MODE !== "1") {
  throw new Error("External product E2E requires OTR_E2E_MODE=1 and a disposable E2E database.");
}
if (e2eMode && e2eWriteToken.length < 32) {
  throw new Error("E2E mode requires OTR_E2E_WRITE_TOKEN with at least 32 characters.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["line"],
    ["json", { outputFile: process.env.OTR_PRODUCT_E2E_JSON ?? "test-results/product-e2e-results.json" }],
    ["junit", { outputFile: process.env.OTR_PRODUCT_E2E_JUNIT ?? "test-results/product-e2e-results.xml" }],
    ["html", { outputFolder: "test-results/e2e-report", open: "never" }],
  ],
  outputDir: "test-results/e2e-artifacts",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: webOrigin,
    viewport: { width: 1440, height: 900 },
    trace: "on",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...(e2eMode ? {
      extraHTTPHeaders: {
        "x-otr-e2e-write-token": e2eWriteToken,
      },
      storageState: process.env.OTR_PRODUCT_E2E_STORAGE_STATE
        ?? "test-results/e2e-storage-state.json",
    } : {}),
  },
  ...(externalStack ? {} : {
    webServer: {
      command: "bash scripts/run-e2e-environment.sh",
      url: webOrigin,
      reuseExistingServer: false,
      timeout: 300_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 30_000 },
    },
  }),
  projects: [{
    name: "chromium",
    use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
  }],
});
