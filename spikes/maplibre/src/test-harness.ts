import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

import { startServer } from "./server.ts";

const require = createRequire(import.meta.url);

function compatibleChromiumPath(expected: string): string {
  if (existsSync(expected)) return expected;

  let expectedBrowserDir = path.dirname(expected);
  while (
    !path.basename(expectedBrowserDir).startsWith("chromium-") &&
    path.dirname(expectedBrowserDir) !== expectedBrowserDir
  ) {
    expectedBrowserDir = path.dirname(expectedBrowserDir);
  }
  const cacheRoot = path.dirname(expectedBrowserDir);
  const suffix = path.relative(expectedBrowserDir, expected);
  if (!existsSync(cacheRoot)) return expected;

  for (const directory of readdirSync(cacheRoot)
    .filter((name) => name.startsWith("chromium-"))
    .sort()
    .reverse()) {
    const candidate = path.join(cacheRoot, directory, suffix);
    if (existsSync(candidate)) return candidate;
  }
  return expected;
}

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
  const executablePath =
    process.env.OTR_A09_CHROMIUM_PATH
    ?? compatibleChromiumPath(chromium.executablePath());
  const args =
    process.env.OTR_A09_DISABLE_CHROMIUM_SANDBOX === "1"
      ? ["--disable-dev-shm-usage", "--no-sandbox"]
      : ["--disable-dev-shm-usage"];
  const browser = await chromium.launch({ executablePath, headless: true, args });
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let page: Page;
  try {
    server = await startServer();
    page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  } catch (error) {
    await browser.close();
    await server?.close();
    throw error;
  }
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
