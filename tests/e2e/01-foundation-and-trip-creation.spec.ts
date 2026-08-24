import { expect, test } from "@playwright/test";

import { API_ORIGIN, caseName, createTrip, signIn } from "./helpers";

test("E2E-001 — Clean-stack readiness and capability discovery", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/Service ready/u)).toBeVisible();
  await expect(page.getByText(/Location search (available|degraded)/u)).toBeVisible();
  await expect.poll(async () => {
    const response = await page.goto(`${API_ORIGIN}/health/ready`);
    return response?.ok();
  }).toBe(true);

  let referenceData: {
    currencies: unknown[];
    costCategories: unknown[];
    transportModes: unknown[];
  } | undefined;
  for (const path of [
    "/health/live",
    "/health/ready",
    "/api/v1/system/reference-data",
    "/api/v1/system/capabilities",
  ]) {
    const response = await page.goto(`${API_ORIGIN}${path}`);
    expect(response?.ok(), `${path} must be reachable from Chromium`).toBe(true);
    if (path.endsWith("reference-data")) {
      referenceData = JSON.parse(await page.locator("body").innerText()) as typeof referenceData;
    }
  }
  expect(referenceData?.currencies).toHaveLength(15);
  expect(referenceData?.costCategories).toHaveLength(9);
  expect(referenceData?.transportModes).toHaveLength(22);

  await page.goto("/");
  await page.reload();
  await expect(page.getByText(/Service ready/u)).toBeVisible();
});

test("E2E-002 — Development login, session persistence and re-login", async ({ page, context }) => {
  const name = caseName("E2E-002", "session");
  const tripId = await createTrip(page, { name });
  const tripUrl = `/trips/${tripId}`;

  await context.clearCookies();
  await page.goto(tripUrl);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await signIn(page, tripUrl);
  await expect(page.locator("#trip-title")).toHaveText(name);
  await page.reload();
  await expect(page.locator("#trip-title")).toHaveText(name);
  await page.reload();
  await expect(page.locator("#trip-title")).toHaveText(name);

  const secondTab = await context.newPage();
  await secondTab.goto(tripUrl);
  await expect(secondTab.locator("#trip-title")).toHaveText(name);
  await secondTab.close();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Session ended" })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await signIn(page, tripUrl);
  await expect(page.locator("#trip-title")).toHaveText(name);
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}$`, "u"));
});

test("E2E-003 — Standard five-day multi-destination Trip creation", async ({ page }) => {
  const name = caseName("E2E-003", "上海与舟山五日");
  await page.goto("/");
  await page.getByRole("link", { name: "Create a trip" }).click();
  const form = page.getByRole("form", { name: "New trip" });
  await form.getByLabel("Trip name").fill(name);
  await form.getByLabel("Start date").fill("2026-10-01");
  await form.getByLabel("End date").fill("2026-10-05");
  await expect(form.getByText("5 daily plans will be created automatically.")).toBeVisible();
  await form.getByLabel("Destinations").fill("上海、舟山");
  await form.getByLabel("Travelers").fill("2");
  await form.getByLabel("Default currency").selectOption("CNY");
  const created = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v1/trips");
  await form.getByRole("button", { name: "Create trip" }).click();
  await expect(form.getByRole("button", { name: "Creating…" })).toBeDisabled();
  const response = await created;
  expect(response.status()).toBe(201);
  const body = await response.json() as {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    totalDays: number;
    travelers: number;
    defaultCurrency: string;
    timezone: string;
    mapProfile: string;
    destinations: Array<{ name: string; countryCode: string }>;
  };
  await expect(page).toHaveURL(new RegExp(`/trips/${body.id}$`, "u"));
  expect(body).toMatchObject({
    name,
    startDate: "2026-10-01",
    endDate: "2026-10-05",
    totalDays: 5,
    travelers: 2,
    defaultCurrency: "CNY",
    timezone: "Asia/Shanghai",
    mapProfile: "cn_primary",
  });
  expect(body.destinations.map(({ name: destination }) => destination)).toEqual(["上海", "舟山"]);
  expect(body.destinations.every(({ countryCode }) => countryCode === "CN")).toBe(true);
  await expect(page.getByRole("complementary", { name: "Trip days" }).getByRole("button", { name: /^Day \d+,/u })).toHaveCount(5);
  await page.reload();
  await expect(page.locator("#trip-title")).toHaveText(name);
  await expect(page.getByRole("complementary", { name: "Trip days" }).getByRole("button", { name: /^Day \d+,/u })).toHaveCount(5);
});

test("E2E-004 — Single-day minimum-value Trip", async ({ page }) => {
  const name = caseName("E2E-004", "东京一日散步");
  await page.goto("/trips/new");
  const form = page.getByRole("form", { name: "New trip" });
  await form.getByLabel("Trip name").fill(name);
  await form.getByLabel("Start date").fill("2026-11-08");
  await form.getByLabel("End date").fill("2026-11-08");
  await form.getByLabel("Destinations").fill("东京");
  await form.getByLabel("Travelers").fill("1");
  await form.getByLabel("Default currency").selectOption("USD");
  await expect(form.getByText("1 daily plan will be created automatically.")).toBeVisible();
  const created = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v1/trips");
  await form.getByRole("button", { name: "Create trip" }).click();
  const body = await (await created).json() as { id: string };
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/u);
  await page.reload();
  await expect(page.locator("#trip-title")).toHaveText(name);
  expect(page.url()).toContain(body.id);
  await expect(page.getByRole("complementary", { name: "Trip days" }).getByRole("button", { name: /^Day \d+,/u })).toHaveCount(1);
  await page.getByRole("link", { name: "Trip settings" }).click();
  await page.getByRole("button", { name: "Edit trip" }).click();
  const settings = page.getByRole("form", { name: "Trip details" });
  await expect(settings.getByLabel("Travelers")).toHaveValue("1");
  await expect(settings.getByLabel("Default currency")).toHaveValue("USD");
  await expect(settings.getByLabel("Map profile")).toHaveValue("international_primary");
});

test("E2E-005 — Leap-date, mixed destination delimiters and maximum form values", async ({ page }) => {
  const name = caseName("E2E-005", "华东闰年跨月旅行");
  await page.goto("/trips/new");
  const form = page.getByRole("form", { name: "New trip" });
  await form.getByLabel("Trip name").fill(name);
  await form.getByLabel("Start date").fill("2028-02-28");
  await form.getByLabel("End date").fill("2028-03-01");
  await expect(form.getByText("3 daily plans will be created automatically.")).toBeVisible();
  await form.getByLabel("Destinations").fill("上海, 杭州，舟山、南京");
  await form.getByLabel("Travelers").fill("99");
  await form.getByLabel("Default currency").selectOption("JPY");
  const created = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v1/trips");
  await form.getByRole("button", { name: "Create trip" }).click();
  const body = await (await created).json() as {
    totalDays: number;
    travelers: number;
    defaultCurrency: string;
    destinations: Array<{ name: string }>;
  };
  expect(body.totalDays).toBe(3);
  expect(body.travelers).toBe(99);
  expect(body.defaultCurrency).toBe("JPY");
  expect(body.destinations.map(({ name: destination }) => destination)).toEqual(["上海", "杭州", "舟山", "南京"]);
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/u);
  await page.reload();
  await expect(page.getByRole("complementary", { name: "Trip days" }).getByRole("button", { name: /^Day \d+,/u })).toHaveCount(3);
  await expect(page.getByText("2028-02-28 — 2028-03-01")).toBeVisible();
});

test("E2E-006 — Duplicate submit and idempotent Trip creation", async ({ page }) => {
  const name = caseName("E2E-006", "idempotent");
  let createRequests = 0;
  let firstTripId = "";
  let firstKey = "";
  await page.route(`${API_ORIGIN}/api/v1/trips`, async (route) => {
    createRequests += 1;
    if (createRequests === 1) {
      firstKey = route.request().headers()["idempotency-key"] ?? "";
      await new Promise((resolve) => setTimeout(resolve, 700));
      const serverResponse = await route.fetch();
      firstTripId = ((await serverResponse.json()) as { id: string }).id;
      await route.abort("connectionfailed");
      return;
    }
    expect(route.request().headers()["idempotency-key"]).toBe(firstKey);
    await route.continue();
  });

  await page.goto("/trips/new");
  const form = page.getByRole("form", { name: "New trip" });
  await form.getByLabel("Trip name").fill(name);
  const submit = form.getByRole("button", { name: "Create trip" });
  await submit.click();
  await expect(form.getByRole("button", { name: "Creating…" })).toBeDisabled();
  await form.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Unable to create" })).toBeVisible();
  expect(createRequests).toBe(1);

  await form.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${firstTripId}$`, "u"));
  expect(createRequests).toBe(2);
  await page.goto("/trips");
  const tripCard = page.locator(`#trip-card-${firstTripId}`);
  await expect(tripCard).toHaveCount(1);
  await expect(tripCard.locator("h2")).toHaveText(name);
});
