import { expect, test } from "@playwright/test";

import { API_ORIGIN, caseName, createTrip } from "./helpers";

test("E2E-001 — clean-stack readiness and capability discovery", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/服务已就绪/u)).toBeVisible();
  await expect(page.getByText(/地点搜索 (可用|降级)/u)).toBeVisible();
  await expect(page.getByText(/Excel (可用|维护中)/u)).toBeVisible();

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
  await expect(page.getByText(/服务已就绪/u)).toBeVisible();
});

test("E2E-002 — development login, session persistence and re-login", async ({ page, context }) => {
  const name = caseName("E2E-002", "session");
  const tripId = await createTrip(page, { name });
  const tripUrl = `/trips/${tripId}`;

  await context.clearCookies();
  await page.goto(tripUrl);
  await expect(page.getByRole("heading", { name: "会话已退出" })).toBeVisible();
  await page.getByRole("button", { name: "重新登录" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  const secondTab = await context.newPage();
  await secondTab.goto(tripUrl);
  await expect(secondTab.getByRole("heading", { name })).toBeVisible();
  await secondTab.close();

  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("heading", { name: "会话已退出" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "会话已退出" })).toBeVisible();
  await page.getByRole("button", { name: "重新登录" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}$`, "u"));
});

test("E2E-003 — standard five-day multi-destination Trip creation", async ({ page }) => {
  const name = caseName("E2E-003", "上海与舟山五日");
  await page.goto("/");
  await page.getByRole("link", { name: "创建我的旅行" }).click();
  const form = page.getByRole("form", { name: "新建旅行" });
  await form.getByLabel("旅行名称").fill(name);
  await form.getByLabel("开始日期").fill("2026-10-01");
  await form.getByLabel("结束日期").fill("2026-10-05");
  await expect(form.getByText("将自动生成 5 天计划")).toBeVisible();
  await form.getByLabel("目的地").fill("上海、舟山");
  await form.getByLabel("同行人数").fill("2");
  await form.getByLabel("默认币种").selectOption("CNY");
  const created = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v1/trips");
  await form.getByRole("button", { name: "创建旅行" }).click();
  await expect(form.getByRole("button", { name: "正在创建…" })).toBeDisabled();
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
  await expect(page.getByRole("navigation", { name: "选择 Day" }).getByRole("button")).toHaveCount(5);
  await page.reload();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "选择 Day" }).getByRole("button")).toHaveCount(5);
});

test("E2E-004 — single-day minimum-value Trip", async ({ page }) => {
  const name = caseName("E2E-004", "东京一日散步");
  await page.goto("/trips/new");
  const form = page.getByRole("form", { name: "新建旅行" });
  await form.getByLabel("旅行名称").fill(name);
  await form.getByLabel("开始日期").fill("2026-11-08");
  await form.getByLabel("结束日期").fill("2026-11-08");
  await form.getByLabel("目的地").fill("东京");
  await form.getByLabel("同行人数").fill("1");
  await form.getByLabel("默认币种").selectOption("USD");
  await expect(form.getByText("将自动生成 1 天计划")).toBeVisible();
  await form.getByRole("button", { name: "创建旅行" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/u);
  await page.reload();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "选择 Day" }).getByRole("button")).toHaveCount(1);
  await page.getByRole("button", { name: "打开旅行设置" }).click();
  const settings = page.getByRole("form", { name: "旅行基本设置" });
  await expect(settings.getByLabel("同行人数")).toHaveValue("1");
  await expect(settings.getByLabel("默认币种")).toHaveValue("USD");
});

test("E2E-005 — leap-date, mixed delimiters and maximum form values", async ({ page }) => {
  const name = caseName("E2E-005", "华东闰年跨月旅行");
  await page.goto("/trips/new");
  const form = page.getByRole("form", { name: "新建旅行" });
  await form.getByLabel("旅行名称").fill(name);
  await form.getByLabel("开始日期").fill("2028-02-28");
  await form.getByLabel("结束日期").fill("2028-03-01");
  await expect(form.getByText("将自动生成 3 天计划")).toBeVisible();
  await form.getByLabel("目的地").fill("上海, 杭州，舟山、南京");
  await form.getByLabel("同行人数").fill("99");
  await form.getByLabel("默认币种").selectOption("JPY");
  const created = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v1/trips");
  await form.getByRole("button", { name: "创建旅行" }).click();
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
  await expect(page.getByRole("navigation", { name: "选择 Day" }).getByRole("button")).toHaveCount(3);
  await expect(page.getByText("2028-02-28 — 2028-03-01")).toBeVisible();
});

test("E2E-006 — duplicate submit and idempotent Trip creation", async ({ page }) => {
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
  const form = page.getByRole("form", { name: "新建旅行" });
  await form.getByLabel("旅行名称").fill(name);
  const submit = form.getByRole("button", { name: "创建旅行" });
  await submit.click();
  await expect(form.getByRole("button", { name: "正在创建…" })).toBeDisabled();
  await form.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "创建失败" })).toBeVisible();
  expect(createRequests).toBe(1);

  await form.getByRole("button", { name: "创建旅行" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${firstTripId}$`, "u"));
  expect(createRequests).toBe(2);
  await page.goto("/trips");
  await expect(page.getByRole("list", { name: "进行中的旅行" }).getByRole("heading", { name })).toHaveCount(1);
});
