import { defineConfig, devices } from "@playwright/test";

const webOrigin = process.env.OTR_PLAYWRIGHT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const webPort = Number(new URL(webOrigin).port);

export default defineConfig({
  testDir: ".",
  testMatch: ["browser/**/*.spec.ts", "e2e/**/*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: webOrigin,
    trace: "retain-on-failure",
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
