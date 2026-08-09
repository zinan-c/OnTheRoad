import { expect, test, type Locator, type Page } from "@playwright/test";
import * as XLSX from "../../packages/importer/vendor/xlsx/xlsx.mjs";

import { caseName, createSimpleItem, createTrip, selectDay } from "./helpers";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=", "base64");
const WEBP = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");

const CURRENCIES = [
  ["CNY", "人民币"], ["USD", "美元"], ["EUR", "欧元"], ["JPY", "日元"], ["KRW", "韩元"],
  ["PHP", "菲律宾比索"], ["THB", "泰铢"], ["SGD", "新加坡元"], ["MYR", "马来西亚林吉特"],
  ["VND", "越南盾"], ["IDR", "印度尼西亚盾"], ["HKD", "港币"], ["TWD", "新台币"],
  ["AUD", "澳大利亚元"], ["GBP", "英镑"],
] as const;

test("E2E-018 — multi-image upload and gallery happy path", async ({ page }) => {
  await createTrip(page, { name: caseName("E2E-018", "gallery") });
  await createSimpleItem(page, "图片归属事项", { kind: "attraction" });
  const workspace = page.getByRole("region", { name: "图片工作台" });
  await workspace.getByLabel("图片归属 Item").selectOption({ label: "Day 1 · 图片归属事项" });
  const gallery = workspace.getByRole("region", { name: "真实图片画廊" });
  await gallery.getByLabel("上传图片").setInputFiles([
    { name: "day-view.jpg", mimeType: "image/jpeg", buffer: JPEG },
    { name: "meal.png", mimeType: "image/png", buffer: PNG },
    { name: "hotel.webp", mimeType: "image/webp", buffer: WEBP },
  ]);
  const cards = gallery.locator("article.galleryCard");
  await expect(cards).toHaveCount(3);
  await expect(gallery.locator('article.galleryCard[data-status="ready"]')).toHaveCount(3, { timeout: 60_000 });
  await expect(gallery.getByRole("status")).toContainText(/已上传|安全处理/u);

  for (const [index, caption] of ["日景", "餐食", "酒店"].entries()) {
    const input = gallery.getByLabel("说明").nth(index);
    await input.fill(caption);
    const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/gallery"));
    await input.blur();
    expect((await saved).ok()).toBe(true);
  }
  await cards.nth(1).getByRole("button", { name: "设为封面" }).click();
  await expect(cards.nth(1).getByRole("button", { name: "设为封面" })).toHaveAttribute("aria-pressed", "true");

  await moveImageForward(page, gallery, 2, 1, "酒店");
  await moveImageForward(page, gallery, 1, 0, "酒店");
  await moveImageForward(page, gallery, 2, 1, "餐食");
  await expect(gallery.getByLabel("说明").nth(0)).toHaveValue("酒店");
  await expect(gallery.getByLabel("说明").nth(1)).toHaveValue("餐食");
  await expect(gallery.getByLabel("说明").nth(2)).toHaveValue("日景");

  await gallery.getByRole("button", { name: "餐食" }).click();
  await expect(page.getByRole("dialog", { name: "图片灯箱" })).toBeVisible();
  await page.getByRole("button", { name: "关闭灯箱" }).click();
  const firstOriginal = cards.nth(2);
  await firstOriginal.getByRole("button", { name: "删除" }).click();
  await firstOriginal.getByRole("button", { name: "确认删除" }).click();
  await expect(gallery.locator('input[value="日景"]')).toHaveCount(0);
  await page.reload();
  const refreshed = page.getByRole("region", { name: "真实图片画廊" });
  await expect(refreshed.getByLabel("说明").nth(0)).toHaveValue("酒店");
  await expect(refreshed.getByLabel("说明").nth(1)).toHaveValue("餐食");
  await expect(refreshed.locator("article.galleryCard").nth(1).getByRole("button", { name: "设为封面" })).toHaveAttribute("aria-pressed", "true");
});

test("E2E-019 — multi-currency expense and summary reconciliation", async ({ page }) => {
  await createTrip(page, {
    name: caseName("E2E-019", "expense-reconciliation"),
    startDate: "2026-10-01",
    endDate: "2026-10-04",
    destinations: "上海、舟山",
  });
  await createSimpleItem(page, "Dining", { kind: "dining", day: 1, mode: "WALK" });
  await createSimpleItem(page, "Transport", { kind: "activity", day: 2, mode: "METRO" });
  await createSimpleItem(page, "Attraction", { kind: "attraction", day: 3, mode: "FERRY" });
  await createSimpleItem(page, "Other", { kind: "other", day: 4, mode: "PUBLIC_BUS" });

  const expenses = page.getByRole("region", { name: "费用工作台" });
  await addExpense(expenses, "Dining", "上海", "200.00", "CNY", "DINING");
  await addExpense(expenses, "Transport", "舟山", "50.25", "USD", "TRANSPORT");
  await addExpense(expenses, "Attraction", "上海", "8000", "JPY", "TICKET");
  await addExpense(expenses, "Other", "舟山", "100000", "VND", "SHOPPING");
  const summary = page.getByRole("region", { name: "费用统计" });
  await expect(summary.getByRole("alert")).toContainText("3 笔费用缺少汇率");

  await saveRate(expenses, "USD", "7.2000");
  await saveRate(expenses, "JPY", "0.0480");
  await saveRate(expenses, "VND", "0.00030");
  await expect(summary).toContainText("975.8000 CNY");
  await expect(summary.getByRole("alert")).toHaveCount(0);
  for (const dimension of ["day", "destination", "category", "mode", "currency"]) {
    await expect(summary.getByRole("region", { name: `${dimension} 统计` })).not.toBeEmpty();
  }
  const details = expenses.getByRole("table", { name: "费用明细" });
  await expect(details).toContainText("50.2500 USD");
  await expect(details).toContainText("7.2000");
  await expect(details).toContainText("8000.0000 JPY");
  await expect(details).toContainText("0.0480");
  await page.reload();
  await expect(page.getByRole("region", { name: "费用统计" })).toContainText("975.8000 CNY");
  await expect(page.getByRole("table", { name: "费用明细" }).getByRole("row")).toHaveCount(5);
});

test("E2E-020 — three-format import, mapping and staging preview", async ({ page }) => {
  test.setTimeout(300_000);
  await createTrip(page, { name: caseName("E2E-020", "three-format-staging") });
  for (const format of ["xlsx", "xls", "csv"] as const) {
    const workspace = page.getByRole("region", { name: "导入映射工作台" });
    await workspace.getByLabel("上传行程文件").setInputFiles(importFile(format));
    await expect(workspace.getByRole("status").filter({ hasText: "正在创建上传会话" })).toBeVisible();
    await expect(workspace.getByRole("status").filter({ hasText: "已生成真实 ImportJob" })).toBeVisible({ timeout: 60_000 });
    const mapping = workspace.getByRole("region", { name: "导入列映射" });
    await expect(mapping).toContainText("建议来自表头别名和示例值");
    const notesRow = mapping.getByRole("row").filter({ hasText: "Notes" });
    await expect(notesRow).toContainText("note");
    await notesRow.getByRole("combobox").selectOption("Remark");
    await mapping.getByRole("button", { name: "保存映射" }).click();
    await expect(workspace.getByRole("status").filter({ hasText: "映射已保存" })).toBeVisible({ timeout: 60_000 });

    const preview = page.getByRole("region", { name: "服务端导入预览" });
    await expect(preview.getByRole("status")).toContainText("尚未写入正式行程");
    await expect(preview).toContainText("原始值");
    await expect(preview).toContainText("规范值");
    await expect(preview.getByRole("button", { name: /全部 3/u })).toBeVisible();
    await preview.getByRole("button", { name: /error 1/u }).click();
    await expect(preview.getByRole("row")).toHaveCount(2);
    await preview.getByRole("button", { name: /跳过当前页错误/u }).click();
    const confirmation = preview.getByRole("alertdialog", { name: "确认跳过错误行" });
    await confirmation.getByRole("button", { name: "确认跳过" }).click();
    await preview.getByRole("button", { name: /skipped 1/u }).click();
    await expect(preview).toContainText("已跳过");
    await page.reload();
    await expect(page.getByRole("region", { name: "导入映射工作台" }).getByRole("row").filter({ hasText: "Notes" }).getByRole("combobox")).toHaveValue("Remark");
    await expect(page.getByRole("region", { name: "服务端导入预览" })).toContainText("尚未写入正式行程");
  }
  await expect(page.getByRole("list", { name: "Day 1 时间线" })).toBeEmpty();
});

test("E2E-021 — full currency Reference Data availability and normalization", async ({ page }) => {
  test.setTimeout(360_000);
  await page.goto("/trips/new");
  const currencySelect = page.getByLabel("默认币种");
  await currencySelect.click();
  await expect(currencySelect.locator("option")).toHaveCount(15);
  await expect(currencySelect.locator("option").allTextContents()).resolves.toEqual(
    CURRENCIES.map(([code, label]) => `${code} · ${label}`),
  );

  for (const [code] of CURRENCIES) {
    const name = caseName("E2E-021", `trip-${code}`);
    await page.goto("/trips/new");
    const form = page.getByRole("form", { name: "新建旅行" });
    await form.getByLabel("旅行名称").fill(name);
    await form.getByLabel("开始日期").fill("2026-11-08");
    await form.getByLabel("结束日期").fill("2026-11-08");
    await form.getByLabel("目的地").fill("东京");
    await form.getByLabel("同行人数").fill("1");
    await form.getByLabel("默认币种").selectOption(code);
    await form.getByRole("button", { name: "创建旅行" }).click();
    await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/u);
    await page.reload();
    await page.getByRole("button", { name: "打开旅行设置" }).click();
    await expect(page.getByRole("form", { name: "旅行基本设置" }).getByLabel("默认币种")).toHaveValue(code);
  }

  await createTrip(page, { name: caseName("E2E-021", "expense-import-reference") });
  await createSimpleItem(page, "币种费用事项", { kind: "other" });
  const expenseWorkspace = page.getByRole("region", { name: "费用工作台" });
  const expenseCurrency = expenseWorkspace.getByRole("form", { name: "新增费用" }).getByLabel("币种", { exact: true });
  await expect(expenseCurrency.locator("option").allTextContents()).resolves.toEqual(
    CURRENCIES.map(([code, label]) => `${code} · ${label}`),
  );
  for (const [index, [code]] of CURRENCIES.entries()) {
    await addExpense(expenseWorkspace, "币种费用事项", "上海", String(index + 1), code, "OTHER");
  }
  const from = expenseWorkspace.getByLabel("原币种");
  const to = expenseWorkspace.getByLabel("目标币种");
  await expect(from.locator("option").allTextContents()).resolves.toEqual(CURRENCIES.map(([code, label]) => `${code} · ${label}`));
  await expect(to.locator("option").allTextContents()).resolves.toEqual(CURRENCIES.map(([code, label]) => `${code} · ${label}`));

  const csv = Buffer.from(`Day,Target,Currency,Notes\n${CURRENCIES.map(([code], index) => `${index + 1},事项${index + 1},${code},code`).join("\n")}\n1,RMB 别名,RMB,alias\n0,错误行,CNY,error\n`);
  const importWorkspace = page.getByRole("region", { name: "导入映射工作台" });
  await importWorkspace.getByLabel("上传行程文件").setInputFiles({ name: "all-currencies.csv", mimeType: "text/csv", buffer: csv });
  await expect(importWorkspace.getByRole("status").filter({ hasText: "已生成真实 ImportJob" })).toBeVisible({ timeout: 60_000 });
  await importWorkspace.getByRole("button", { name: "保存映射" }).click();
  await expect(importWorkspace.getByRole("status").filter({ hasText: "映射已保存" })).toBeVisible({ timeout: 60_000 });
  const preview = page.getByRole("region", { name: "服务端导入预览" });
  await preview.getByLabel("搜索源行").fill("RMB");
  await expect(preview).toContainText("Currency: RMB");
  await expect(preview).toContainText("currency: CNY");
  for (const [code] of CURRENCIES) {
    await preview.getByLabel("搜索源行").fill(code);
    await expect(preview).toContainText(`Currency: ${code}`);
  }
});

async function addExpense(workspace: Locator, item: string, destination: string, amount: string, currency: string, category: string) {
  const form = workspace.getByRole("form", { name: "新增费用" });
  const itemOption = form.getByLabel("费用归属 Item").locator("option").filter({ hasText: item });
  await form.getByLabel("费用归属 Item").selectOption(await itemOption.getAttribute("value") ?? "");
  await form.getByLabel("费用归属目的地").selectOption({ label: destination });
  await form.getByLabel("金额").fill(amount);
  await form.getByLabel("币种").selectOption(currency);
  await form.getByLabel("费用类别").selectOption(category);
  await form.getByRole("button", { name: "添加费用" }).click();
  await expect(workspace.getByRole("status")).toContainText(`已为“${item}”保存费用`);
}

async function saveRate(workspace: Locator, currency: string, rate: string) {
  const form = workspace.getByRole("form", { name: "汇率管理" });
  await form.getByLabel("原币种").selectOption(currency);
  await form.getByLabel("汇率", { exact: true }).fill(rate);
  await form.getByRole("button", { name: "保存汇率" }).click();
  await expect(workspace.getByRole("status")).toContainText(`已保存 ${currency}→CNY 汇率`);
}

async function moveImageForward(page: Page, gallery: Locator, fromIndex: number, expectedIndex: number, caption: string) {
  const reordered = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/gallery/reorder"));
  await gallery.locator("article.galleryCard").nth(fromIndex).getByRole("button", { name: "前移图片" }).click();
  expect((await reordered).ok()).toBe(true);
  await expect(gallery.getByLabel("说明").nth(expectedIndex)).toHaveValue(caption);
}

function importFile(format: "xlsx" | "xls" | "csv") {
  const rows = [
    ["Day", "Target", "Notes"],
    [1, `${format} 新事项`, "note one"],
    [2, `${format} 第二事项`, "note two"],
    [0, `${format} 错误事项`, "bad day"],
  ];
  if (format === "csv") {
    return { name: "mixed.csv", mimeType: "text/csv", buffer: Buffer.from(rows.map((row) => row.join(",")).join("\n")) };
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Itinerary");
  return {
    name: `itinerary.${format}`,
    mimeType: format === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/vnd.ms-excel",
    buffer: Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: format, ...(format === "xlsx" ? { compression: true } : {}) })),
  };
}
