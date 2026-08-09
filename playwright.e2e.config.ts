import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["line"], ["html", { outputFolder: "test-results/e2e-report", open: "never" }]],
  outputDir: "test-results/e2e-artifacts",
  use: {
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 1440, height: 900 },
    trace: "on",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "bash scripts/run-e2e-environment.sh",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 300_000,
  },
  projects: [{
    name: "chromium",
    use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
  }],
});
