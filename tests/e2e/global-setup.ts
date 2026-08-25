import { mkdir } from "node:fs/promises";
import { request, type FullConfig } from "@playwright/test";

const DEFAULT_TOKEN = "e2e-local-write-token-change-per-run-123456";
const DEFAULT_USERNAME = "e2e_playwright";
const DEFAULT_PASSWORD = "E2e_Playwright_1234!";

export default async function globalSetup(config: FullConfig): Promise<void> {
  const webOrigin = process.env.OTR_PLAYWRIGHT_WEB_ORIGIN
    ?? String(config.projects[0]?.use.baseURL ?? "http://127.0.0.1:3100");
  const apiOrigin = process.env.OTR_PLAYWRIGHT_API_ORIGIN ?? "http://127.0.0.1:3101";
  const username = process.env.OTR_E2E_USERNAME ?? DEFAULT_USERNAME;
  const password = process.env.OTR_E2E_PASSWORD ?? DEFAULT_PASSWORD;
  const token = process.env.OTR_E2E_WRITE_TOKEN ?? DEFAULT_TOKEN;
  const configuredStorageState = config.projects[0]?.use.storageState;
  const storageState = process.env.OTR_PRODUCT_E2E_STORAGE_STATE
    ?? (typeof configuredStorageState === "string"
      ? configuredStorageState
      : "test-results/e2e-storage-state.json");
  const context = await request.newContext({
    baseURL: apiOrigin,
    extraHTTPHeaders: { "x-otr-e2e-write-token": token },
  });
  try {
    await waitForApiReadiness(context);
    const response = await context.post("/api/v1/identity/password-session", {
      headers: { origin: new URL(webOrigin).origin },
      data: { username, password },
    });
    if (!response.ok()) {
      throw new Error("E2E temporary account login failed: HTTP " + response.status());
    }
    const result = await response.json() as { mustChangePassword?: boolean };
    if (result.mustChangePassword) {
      throw new Error("E2E temporary account must not require a password change.");
    }
    await mkdir(storageState.split("/").slice(0, -1).join("/") || ".", { recursive: true });
    await context.storageState({ path: storageState });
  } finally {
    await context.dispose();
  }
}

async function waitForApiReadiness(context: Awaited<ReturnType<typeof request.newContext>>): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await context.get("/health/ready", { timeout: 2_000 });
      const ready = response.ok();
      await response.dispose();
      if (ready) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("E2E API readiness timed out before temporary-account login.", { cause: lastError });
}
