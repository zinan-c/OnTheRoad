import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./browser",
  fullyParallel: false,
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
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @on-the-road/web build && pnpm --filter @on-the-road/web start",
      cwd: "../..",
      port: 3000,
      reuseExistingServer: false,
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
