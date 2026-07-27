import { createRequire } from "node:module";
import type { Page } from "@playwright/test";

import { startServer } from "./server.ts";

const require = createRequire(import.meta.url);

export async function launchHarness({
  scenario,
}: {
  scenario: "default" | "tile-failure" | "zero" | "one" | "same" | "webgl-failure";
}): Promise<{
  page: Page;
  open: () => Promise<void>;
  close: () => Promise<void>;
}> {
  const { chromium } = require("@playwright/test");
  const server = await startServer();
  const executablePath =
    process.env.OTR_A09_CHROMIUM_PATH ?? chromium.executablePath();
  const args =
    process.env.OTR_A09_DISABLE_CHROMIUM_SANDBOX === "1"
      ? ["--disable-dev-shm-usage", "--no-sandbox"]
      : ["--disable-dev-shm-usage"];
  const browser = await chromium.launch({ executablePath, headless: true, args });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  return {
    page,
    async open() {
      await page.goto(`${server.origin}/?scenario=${scenario}`, { waitUntil: "load" });
      await page.waitForFunction(
        () => (window as typeof window & { __HARNESS_READY__?: boolean }).__HARNESS_READY__ === true,
      );
    },
    async close() {
      await browser.close();
      await server.close();
    },
  };
}
