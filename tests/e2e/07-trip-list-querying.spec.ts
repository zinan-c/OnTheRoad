import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import {
  API_ORIGIN,
  caseName,
  createSimpleItem,
  createTrip,
  openItem,
  waitForAutosave,
} from "./helpers";

const WEB_ORIGIN = process.env.OTR_PLAYWRIGHT_WEB_ORIGIN ?? "http://127.0.0.1:3100";

test("Trip list pagination has no duplicates or omissions and restores query URLs", async ({ page, context, request }) => {
  const prefix = caseName("Trip list", "pagination");
  const expected = Array.from({ length: 45 }, (_, index) => `${prefix}-${String(index + 1).padStart(3, "0")}`);
  const created = await Promise.all(expected.map((name, index) => createApiTrip(
    request,
    name,
    `${prefix} destination ${String(index + 1).padStart(3, "0")}`,
  )));
  const expectedIds = new Set(created.map(({ id }) => id));

  await page.goto(`/trips?search=${encodeURIComponent(prefix)}&sort=name&order=asc`);
  const first = await visibleTripIds(page, "Active trips", 20);
  await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
  await page.getByRole("button", { name: "Next" }).click();
  const second = await visibleTripIds(page, "Active trips", 20);
  const copiedPageUrl = page.url();

  const copiedPage = await context.newPage();
  await copiedPage.goto(copiedPageUrl);
  expect(await visibleTripIds(copiedPage, "Active trips", 20)).toEqual(second);
  await expect(copiedPage.getByRole("button", { name: "Previous" })).toBeEnabled();
  await copiedPage.getByRole("button", { name: "Previous" }).click();
  expect(await visibleTripIds(copiedPage, "Active trips", 20)).toEqual(first);
  await copiedPage.close();

  await page.getByRole("button", { name: "Next" }).click();
  const third = await visibleTripIds(page, "Active trips", 5);
  const allIds = [...first, ...second, ...third];
  expect(new Set(allIds).size).toBe(45);
  expect(new Set(allIds)).toEqual(expectedIds);

  const search = page.getByRole("textbox", { name: "Search trips" });
  await search.fill(`${prefix} destination 045`);
  await page.getByRole("button", { name: "Search" }).click();
  expect(new URL(page.url()).searchParams.get("search")).toBe(`${prefix} destination 045`);
  await expect(page.getByRole("list", { name: "Active trips" }).locator("li[id^='trip-card-'] h2")).toHaveText([expected.at(-1)!]);

  await search.fill(prefix);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("combobox", { name: "Sort order" }).selectOption("desc");
  const descendingNames = page.getByRole("list", { name: "Active trips" }).locator("li[id^='trip-card-'] h2");
  await expect(descendingNames).toHaveCount(20);
  await expect(descendingNames).toHaveText(expected.slice().reverse().slice(0, 20));
  expect(new URL(page.url()).searchParams.get("order")).toBe("desc");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Search trips" })).toHaveValue(prefix);
  await expect(page.getByRole("combobox", { name: "Sort trips" })).toHaveValue("name");
  await expect(page.getByRole("combobox", { name: "Sort order" })).toHaveValue("desc");
  await expect(descendingNames).toHaveText(expected.slice().reverse().slice(0, 20));
});

test("Trip list keeps Trash active when a superseded Active request is delayed", async ({ page, request }) => {
  const prefix = caseName("Trip list", "request race");
  const active = await createApiTrip(request, `${prefix} active`, `${prefix} active destination`);
  const deleted = await createApiTrip(request, `${prefix} trash`, `${prefix} trash destination`);
  const deletedResponse = await request.delete(`${API_ORIGIN}/api/v1/trips/${deleted.id}`, {
    headers: { "If-Match": String(deleted.version), origin: WEB_ORIGIN },
  });
  expect(deletedResponse.ok()).toBe(true);

  await page.goto(`/trips?view=deleted&search=${encodeURIComponent(prefix)}&sort=name&order=asc`);
  await expect(page.locator(`#trip-card-${deleted.id}`)).toBeVisible();

  let releaseActive!: () => void;
  const activeRelease = new Promise<void>((resolve) => { releaseActive = resolve; });
  let activeRequestSeen!: () => void;
  const activeRequest = new Promise<void>((resolve) => { activeRequestSeen = resolve; });
  let activeRequestFinished!: () => void;
  const activeFinished = new Promise<void>((resolve) => { activeRequestFinished = resolve; });
  await page.route(`${API_ORIGIN}/api/v1/trips?*`, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("status") !== "active" || url.searchParams.get("search") !== prefix) {
      await route.continue();
      return;
    }
    activeRequestSeen();
    await activeRelease;
    try {
      await route.continue();
    } catch {
      // The browser is expected to cancel this superseded request.
    } finally {
      activeRequestFinished();
    }
  });

  await page.getByRole("tab", { name: "Active trips" }).click();
  await activeRequest;
  await page.getByRole("tab", { name: "Trash" }).click();
  await expect(page.locator(`#trip-card-${deleted.id}`)).toBeVisible();
  await expect(page.locator(`#trip-card-${active.id}`)).toHaveCount(0);
  releaseActive();
  await activeFinished;
  await expect(page.getByRole("tab", { name: "Trash" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(`#trip-card-${deleted.id}`)).toBeVisible();
  await expect(page.locator(`#trip-card-${active.id}`)).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("view")).toBe("deleted");
});

test("Trip recent activity moves after a child resource update", async ({ page }) => {
  const prefix = caseName("Trip list", "child activity");
  const firstId = await createTrip(page, { name: `${prefix} A` });
  const itemId = await createSimpleItem(page, `${prefix} original item`);
  const secondId = await createTrip(page, { name: `${prefix} B` });

  await page.goto(`/trips?search=${encodeURIComponent(prefix)}`);
  const names = page.getByRole("list", { name: "Active trips" }).locator("li[id^='trip-card-'] h2");
  await expect(names).toHaveText([`${prefix} B`, `${prefix} A`]);

  await page.goto(`/trips/${firstId}`);
  const editor = await openItem(page, itemId);
  await editor.getByLabel("Item name").fill(`${prefix} updated item`);
  await waitForAutosave(editor);

  await page.goto(`/trips?search=${encodeURIComponent(prefix)}`);
  await expect(names).toHaveText([`${prefix} A`, `${prefix} B`]);
  await expect(page.locator(`#trip-card-${firstId}`)).toBeVisible();
  await expect(page.locator(`#trip-card-${secondId}`)).toBeVisible();
});

async function createApiTrip(request: APIRequestContext, name: string, destination: string) {
  const response = await request.post(`${API_ORIGIN}/api/v1/trips`, {
    headers: { "Idempotency-Key": randomUUID(), origin: WEB_ORIGIN },
    data: {
      name,
      startDate: "2026-10-01",
      endDate: "2026-10-01",
      travelers: 1,
      defaultCurrency: "CNY",
      timezone: "Asia/Shanghai",
      mapProfile: "cn_primary",
      destinations: [{ name: destination, countryCode: "CN" }],
    },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string; version: number }>;
}

async function visibleTripIds(page: Page, listName: string, count: number): Promise<string[]> {
  const cards = page.getByRole("list", { name: listName }).locator("li[id^='trip-card-']");
  await expect(cards).toHaveCount(count);
  return cards.evaluateAll((elements) => elements.map((element) => element.id.replace("trip-card-", "")));
}
