import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  API_ORIGIN,
  caseName,
  createSimpleItem,
  createTrip,
} from "./helpers";

const CURRENCIES = [
  "CNY", "USD", "EUR", "JPY", "KRW", "PHP", "THB", "SGD",
  "MYR", "VND", "IDR", "HKD", "TWD", "AUD", "GBP",
] as const;

const GALLERY_FIXTURES = [
  resolve(process.cwd(), "packages/test-fixtures/images/product-e2e/day-view.jpg"),
  resolve(process.cwd(), "packages/test-fixtures/images/product-e2e/meal.png"),
  resolve(process.cwd(), "packages/test-fixtures/images/product-e2e/hotel.webp"),
] as const;

const IMPORT_FIXTURES = [
  resolve(process.cwd(), "packages/test-fixtures/imports/product-e2e.xlsx"),
  resolve(process.cwd(), "packages/test-fixtures/imports/product-e2e.xls"),
  resolve(process.cwd(), "packages/test-fixtures/imports/product-e2e.csv"),
] as const;

test("E2E-018 — Multi-image upload and gallery happy path", async ({ page }) => {
  test.setTimeout(240_000);
  const tripId = await createTrip(page, {
    name: caseName("E2E-018", "gallery-product"),
    startDate: "2026-10-01",
    endDate: "2026-10-01",
  });
  const itemId = await createSimpleItem(page, "Gallery owner", { kind: "attraction", day: 1 });
  const workspace = page.getByRole("region", { name: "图片工作台" });
  const gallery = workspace.getByRole("region", { name: "真实图片画廊" });
  const fileInput = gallery.getByLabel("上传图片");
  await expect(fileInput).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
  await expect(fileInput).toHaveAttribute("multiple", "");

  await fileInput.setInputFiles([...GALLERY_FIXTURES]);
  await expect(gallery.getByRole("status")).toContainText(/正在准备|正在上传|正在安全处理/u, { timeout: 15_000 });

  const cards = gallery.locator('article[data-status="ready"]');
  await expect(cards).toHaveCount(3, { timeout: 120_000 });
  const uploaded = await readJson<GalleryAttachment[]>(page, `/trips/${tripId}/itinerary-items/${itemId}/gallery`);
  expect(uploaded).toHaveLength(3);
  expect(new Set(uploaded.map(({ contentType }) => contentType))).toEqual(new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
  ]));
  for (const attachment of uploaded) {
    expect(attachment.status).toBe("ready");
    expect(attachment.contentLength).toBeGreaterThan(0);
    expect(attachment.checksumSha256).toMatch(/^[A-Za-z0-9+/]{43}=$/u);
    expect(attachment.objectVersion).toBeTruthy();
    expect(attachment.etag).toBeTruthy();
  }

  const captions = ["Day view caption", "Meal caption", "Hotel caption"];
  for (const [index, caption] of captions.entries()) {
    const card = gallery.locator("article.galleryCard").nth(index);
    await card.getByLabel("说明").fill(caption);
    await card.getByLabel("说明").blur();
    await expect.poll(async () => {
      const current = await readJson<GalleryAttachment[]>(page, `/trips/${tripId}/itinerary-items/${itemId}/gallery`);
      return current[index]?.caption;
    }, { timeout: 15_000 }).toBe(caption);
  }

  const galleryCards = gallery.locator("article.galleryCard");
  await galleryCards.nth(1).getByRole("button", { name: "设为封面" }).click();
  await expect.poll(async () => {
    const current = await readJson<GalleryAttachment[]>(page, `/trips/${tripId}/itinerary-items/${itemId}/gallery`);
    return current.find(({ caption }) => caption === "Meal caption")?.isCover;
  }, { timeout: 15_000 }).toBe(true);

  await galleryCards.nth(1).locator(".galleryPreview").click();
  const lightbox = page.getByRole("dialog", { name: "图片灯箱" });
  await expect(lightbox).toBeVisible();
  await lightbox.getByRole("button", { name: "关闭灯箱" }).click();
  await expect(lightbox).toHaveCount(0);

  await galleryCards.nth(0).getByRole("button", { name: "后移图片" }).click();
  await expect.poll(async () => galleryCaptions(page, tripId, itemId), { timeout: 15_000 })
    .toEqual(["Meal caption", "Day view caption", "Hotel caption"]);
  await gallery.locator("article.galleryCard").nth(2).getByRole("button", { name: "前移图片" }).click();
  await expect.poll(async () => galleryCaptions(page, tripId, itemId), { timeout: 15_000 })
    .toEqual(["Meal caption", "Hotel caption", "Day view caption"]);
  await gallery.locator("article.galleryCard").nth(1).getByRole("button", { name: "前移图片" }).click();
  await expect.poll(async () => galleryCaptions(page, tripId, itemId), { timeout: 15_000 })
    .toEqual(["Hotel caption", "Meal caption", "Day view caption"]);

  const firstCard = gallery.locator("article.galleryCard").first();
  await firstCard.getByRole("button", { name: "删除", exact: true }).click();
  await expect(firstCard.getByRole("button", { name: "确认删除" })).toBeVisible();
  await firstCard.getByRole("button", { name: "确认删除" }).click();
  await expect(gallery.locator("article.galleryCard")).toHaveCount(2);

  await page.reload();
  const reloadedGallery = page.getByRole("region", { name: "真实图片画廊" });
  await expect(reloadedGallery.locator('article[data-status="ready"]')).toHaveCount(2, { timeout: 30_000 });
  const restored = await readJson<GalleryAttachment[]>(page, `/trips/${tripId}/itinerary-items/${itemId}/gallery`);
  expect(restored.map(({ caption }) => caption)).toEqual(["Meal caption", "Day view caption"]);
  expect(restored[0]?.isCover).toBe(true);
});

test("E2E-019 — Multi-currency expense and summary reconciliation", async ({ page }) => {
  await createTrip(page, {
    name: caseName("E2E-019", "expense-reconciliation"),
    startDate: "2026-10-01",
    endDate: "2026-10-04",
    destinations: "Shanghai, Zhoushan",
  });
  await createSimpleItem(page, "Dining", { kind: "dining", day: 1, mode: "WALK", expense: { amount: "200.00", currency: "CNY", remark: "Dinner" } });
  await createSimpleItem(page, "Transport", { kind: "activity", day: 2, mode: "METRO", expense: { amount: "50.25", currency: "USD", remark: "Ferry transfer" } });
  await createSimpleItem(page, "Attraction", { kind: "attraction", day: 3, mode: "FERRY", expense: { amount: "8000", currency: "JPY", remark: "Museum tickets" } });
  await createSimpleItem(page, "Other", { kind: "other", day: 4, mode: "PUBLIC_BUS", expense: { amount: "100000", currency: "VND", remark: "Trip supplies" } });

  const expenses = page.getByRole("region", { name: "Expense workspace" });
  await expect(expenses.getByRole("form", { name: "Add expense" })).toHaveCount(0);
  const summary = page.getByRole("region", { name: "Expense summary" });
  await expect(summary.getByRole("alert")).toContainText("3 expenses are missing exchange rates");

  await saveRate(expenses, "USD", "7.2000");
  await saveRate(expenses, "JPY", "0.0480");
  await saveRate(expenses, "VND", "0.00030");
  await expect(summary).toContainText("975.8000 CNY");
  await expect(summary.getByRole("alert")).toHaveCount(0);
  await summary.locator("#expense-day-2").click();
  const details = summary.getByRole("table", { name: "Daily expense details" });
  await expect(details).toContainText("50.2500 USD");
  await expect(details).toContainText("Ferry transfer");
  await expect(details).toContainText("7.2000");
  await page.reload();
  await expect(page.getByRole("region", { name: "Expense summary" })).toContainText("975.8000 CNY");
});

test("E2E-020 — Three-format import, mapping and staging preview", async ({ page }) => {
  test.setTimeout(300_000);
  const tripId = await createTrip(page, {
    name: caseName("E2E-020", "import-product"),
    startDate: "2026-10-01",
    endDate: "2026-10-01",
  });
  const before = await productionCounts(page, tripId);
  const workspace = page.getByRole("region", { name: "导入映射工作台" });
  const fileInput = workspace.getByLabel("上传行程文件");

  for (const fixture of IMPORT_FIXTURES) {
    const observed = { session: false, objectUpload: false, inspection: false };
    const onRequest = (request: import("@playwright/test").Request) => {
      const url = request.url();
      if (request.method() === "POST" && url.includes(`/trips/${tripId}/imports/uploads`)) observed.session = true;
      if (request.method() === "PUT" && url.includes("/api/v1") === false) observed.objectUpload = true;
      if (request.method() === "POST" && url.includes(`/trips/${tripId}/imports/`) && url.endsWith("/inspection")) observed.inspection = true;
    };
    page.on("request", onRequest);
    await fileInput.setInputFiles(fixture);
    await expect(workspace.getByRole("status")).toContainText(/正在创建上传会话|正在上传文件|正在扫描并检查文件/u, { timeout: 15_000 });
    await expect(workspace.getByRole("status")).toContainText("已生成真实 ImportJob", { timeout: 120_000 });
    page.off("request", onRequest);
    expect(observed).toEqual({ session: true, objectUpload: true, inspection: true });

    const latest = await readJson<LatestImport>(page, `/trips/${tripId}/imports/latest`);
    const mapping = page.getByRole("region", { name: "导入列映射" });
    await expect(mapping).toContainText("建议来自表头别名和示例值");
    const manualRow = mapping.locator("tbody tr").filter({ hasText: "Comment" });
    await expect(manualRow).toHaveCount(1);
    await expect(manualRow).toContainText("manual comment");
    await manualRow.locator("select").selectOption("Remark");
    await expect(manualRow).toContainText("手工映射");
    await mapping.getByRole("button", { name: "保存映射" }).click();
    await expect(workspace.getByRole("status").filter({ hasText: "映射已保存" })).toBeVisible({ timeout: 30_000 });

    const preview = page.getByRole("region", { name: "服务端导入预览" });
    await expect(preview.getByRole("table")).toBeVisible({ timeout: 120_000 });
    await expect(preview.getByRole("status")).toContainText("导入预览，尚未写入正式行程");
    const initialPreview = await readJson<PreviewPayload>(page, `/imports/${latest.id}/preview?page=1&pageSize=50`);
    expect(initialPreview.rows.length).toBe(initialPreview.counts.total);
    expect(Object.values(initialPreview.counts).filter((value): value is number => typeof value === "number").slice(1).reduce((sum, value) => sum + value, 0)).toBe(initialPreview.counts.total);
    expect(initialPreview.rows.some(({ rawData }) => rawData.Comment === "manual comment")).toBe(true);
    expect(initialPreview.rows.some(({ normalizedData }) => normalizedData?.remark === "manual comment")).toBe(true);
    expect(initialPreview.rows.some(({ errors }) => errors.length > 0)).toBe(true);

    const filter = preview.getByRole("navigation", { name: "预览状态筛选" });
    for (const status of ["all", "new", "update", "duplicate", "error", "unresolved", "skipped"] as const) {
      const count = initialPreview.counts[status === "all" ? "total" : status];
      const button = filter.getByRole("button", { name: new RegExp(`^${status === "all" ? "全部" : status} ${count}$`, "u") });
      await expect(button).toBeVisible();
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
    }

    if (initialPreview.counts.error > 0) {
      const errorButton = filter.getByRole("button", { name: new RegExp(`^error ${initialPreview.counts.error}$`, "u") });
      await errorButton.click();
      await expect(preview.getByRole("button", { name: /跳过当前页错误/u })).toBeVisible();
      await preview.getByRole("button", { name: /跳过当前页错误/u }).click();
      const confirmation = preview.getByRole("alertdialog", { name: "确认跳过错误行" });
      await expect(confirmation).toBeVisible();
      await confirmation.getByRole("button", { name: "确认跳过" }).click();
      await expect.poll(async () => {
        const current = await readJson<PreviewPayload>(page, `/imports/${latest.id}/preview?page=1&pageSize=50`);
        return current.counts.skipped;
      }, { timeout: 30_000 }).toBe(initialPreview.counts.skipped + initialPreview.counts.error);
    }

    await page.reload();
    const restoredMapping = page.getByRole("region", { name: "导入列映射" });
    await expect(restoredMapping).toBeVisible({ timeout: 30_000 });
    await expect(restoredMapping.locator("tbody tr").filter({ hasText: "Comment" }).locator("select")).toHaveValue("Remark");
    await expect(page.getByRole("region", { name: "服务端导入预览" }).getByRole("table")).toBeVisible({ timeout: 30_000 });
    expect(await productionCounts(page, tripId)).toEqual(before);
  }
});

test("E2E-021 — Full currency Reference Data availability and normalization", async ({ page }) => {
  test.setTimeout(360_000);
  const reference = await readJson<{ currencies: readonly { code: string }[] }>(page, "/system/reference-data");
  expect(reference.currencies.map(({ code }) => code)).toEqual([...CURRENCIES]);

  for (const currency of CURRENCIES) {
    const tripId = await createTrip(page, {
      name: caseName("E2E-021", `currency-${currency}`),
      startDate: "2026-10-01",
      endDate: "2026-10-01",
      currency,
    });
    await page.reload();
    await page.goto(`/trips/${tripId}/settings`);
    const settings = page.locator(".settingsPage");
    await expect(settings.locator("dl.settingsSummary")).toContainText(currency);
    const trip = await readJson<{ defaultCurrency: string }>(page, `/trips/${tripId}`);
    expect(trip.defaultCurrency).toBe(currency);

    await page.goto(`/trips/${tripId}`);
    const itemId = await createSimpleItem(page, `Expense ${currency}`, {
      kind: "other",
      day: 1,
      expense: { amount: "12.34", currency, remark: "Original currency" },
    });
    const expenses = await readJson<readonly { originalAmount: string; currency: string; remark: string }[]>(page, `/trips/${tripId}/itinerary-items/${itemId}/expenses`);
    expect(expenses).toEqual(expect.arrayContaining([
      expect.objectContaining({ originalAmount: "12.34", currency, remark: "Original currency" }),
    ]));
    const summary = page.getByRole("region", { name: "Expense summary" });
    await expect(summary).toContainText("12.34");
    await expect(summary).toContainText(currency);
    await page.reload();
    await expect(page.getByRole("region", { name: "Expense summary" })).toContainText("12.34");

    const expenseWorkspace = page.getByRole("region", { name: "Expense workspace" });
    await expect(expenseWorkspace.getByLabel("Source currency").locator("option").allTextContents()).resolves.toEqual([...CURRENCIES]);
    await expect(expenseWorkspace.getByLabel("Settlement currency").locator("option").allTextContents()).resolves.toEqual([...CURRENCIES]);
    const rateForm = expenseWorkspace.getByRole("form", { name: "Exchange rate management" });
    await rateForm.getByLabel("Source currency").selectOption("CNY");
    await rateForm.getByLabel("Exchange rate", { exact: true }).fill("1");
    await rateForm.getByRole("button", { name: "Save rate" }).click();
    await expect(expenseWorkspace.getByRole("alert")).toContainText("different");
  }

  const tripId = await createTrip(page, {
    name: caseName("E2E-021", "currency-fixture"),
    startDate: "2026-10-01",
    endDate: "2026-10-01",
    currency: "CNY",
  });
  const fileInput = page.getByRole("region", { name: "导入映射工作台" }).getByLabel("上传行程文件");
  await fileInput.setInputFiles(resolve(process.cwd(), "packages/test-fixtures/imports/product-currencies.csv"));
  const importWorkspace = page.getByRole("region", { name: "导入映射工作台" });
  await expect(importWorkspace.getByRole("status")).toContainText("已生成真实 ImportJob", { timeout: 120_000 });
  const latest = await readJson<LatestImport>(page, `/trips/${tripId}/imports/latest`);
  const mapping = page.getByRole("region", { name: "导入列映射" });
  await mapping.getByRole("button", { name: "保存映射" }).click();
  await expect(importWorkspace.getByRole("status").filter({ hasText: "映射已保存" })).toBeVisible({ timeout: 30_000 });
  const previewRegion = page.getByRole("region", { name: "服务端导入预览" });
  await expect(previewRegion.getByRole("table")).toBeVisible({ timeout: 120_000 });
  await expect(previewRegion).toContainText("currency: CNY");
  await expect(previewRegion).toContainText("currency: USD");
  const preview = await readJson<PreviewPayload>(page, `/imports/${latest.id}/preview?page=1&pageSize=50`);
  expect(preview.counts.total).toBe(16);
  expect(preview.counts.error).toBe(0);
  const normalizedCurrencies = preview.rows.map(({ normalizedData }) => normalizedData?.currency);
  expect(normalizedCurrencies).toContain("CNY");
  expect(normalizedCurrencies).toContain("USD");
  expect(preview.rows.find(({ rawData }) => String(rawData.Currency).toUpperCase() === "RMB")?.normalizedData?.currency).toBe("CNY");
  for (const currency of CURRENCIES.filter((code) => code !== "CNY")) {
    expect(normalizedCurrencies).toContain(currency);
  }
});

type GalleryAttachment = {
  readonly id: string;
  readonly status: string;
  readonly contentType?: string;
  readonly contentLength?: number;
  readonly checksumSha256?: string;
  readonly objectVersion?: string;
  readonly etag?: string;
  readonly caption: string;
  readonly sortOrder: number;
  readonly isCover: boolean;
};

type LatestImport = { readonly id: string; readonly status: string };

type PreviewRow = {
  readonly rawData: Record<string, unknown>;
  readonly normalizedData?: Record<string, unknown>;
  readonly errors: readonly unknown[];
  readonly status: string;
};

type PreviewPayload = {
  readonly rows: readonly PreviewRow[];
  readonly counts: { readonly total: number; readonly new: number; readonly update: number; readonly duplicate: number; readonly error: number; readonly unresolved: number; readonly skipped: number };
};

async function readJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`${API_ORIGIN}/api/v1${path}`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<T>;
}

async function galleryCaptions(page: Page, tripId: string, itemId: string): Promise<string[]> {
  const current = await readJson<GalleryAttachment[]>(page, `/trips/${tripId}/itinerary-items/${itemId}/gallery`);
  return current.map(({ caption }) => caption);
}

async function productionCounts(page: Page, tripId: string) {
  const days = await readJson<readonly { id: string }[]>(page, `/trips/${tripId}/days`);
  const items = (await Promise.all(days.map(({ id }) => readJson<readonly { id: string; locationId?: string | null; startLocationId?: string | null; endLocationId?: string | null }[]>(page, `/trips/${tripId}/days/${id}/itinerary-items`)))).flat();
  const expenses = (await Promise.all(items.map(({ id }) => readJson<readonly unknown[]>(page, `/trips/${tripId}/itinerary-items/${id}/expenses`)))).flat();
  const locations = new Set(items.flatMap(({ locationId, startLocationId, endLocationId }) => [locationId, startLocationId, endLocationId].filter((value): value is string => Boolean(value))));
  return { items: items.length, locations: locations.size, expenses: expenses.length };
}

async function saveRate(workspace: Locator, currency: string, rate: string) {
  const form = workspace.getByRole("form", { name: "Exchange rate management" });
  await form.getByLabel("Source currency").selectOption(currency);
  await form.getByLabel("Exchange rate", { exact: true }).fill(rate);
  await form.getByRole("button", { name: "Save rate" }).click();
  await expect(workspace.getByRole("status")).toContainText(`${currency}→CNY saved`);
}
