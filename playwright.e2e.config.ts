import { defineConfig, devices } from "@playwright/test";

const externalStack = process.env.OTR_PLAYWRIGHT_EXTERNAL_STACK === "1";
const webOrigin = process.env.OTR_PLAYWRIGHT_WEB_ORIGIN ?? "http://127.0.0.1:3100";

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
  use: {
    baseURL: webOrigin,
    viewport: { width: 1440, height: 900 },
    trace: "on",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  ...(externalStack ? {} : {
    webServer: {
      command: "bash scripts/run-e2e-environment.sh",
      url: webOrigin,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  }),
  projects: [{
    name: "chromium",
    use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
  }],
});
