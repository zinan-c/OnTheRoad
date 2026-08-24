import { expect, type Page } from "@playwright/test";

const E2E_USERNAME = process.env.OTR_E2E_USERNAME ?? "e2e_playwright";
const E2E_PASSWORD = process.env.OTR_E2E_PASSWORD ?? "E2e_Playwright_1234!";

export async function signIn(page: Page, returnTo: string): Promise<void> {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  const form = page.getByRole("form", { name: "登录" });
  await form.getByLabel("用户名").fill(E2E_USERNAME);
  await form.getByLabel("密码").fill(E2E_PASSWORD);
  await form.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(new RegExp(`${returnTo.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "u"));
}

async function createTrip(page: Page, name: string, endDate?: string) {
  await page.goto("/");
  await page.getByTestId("create-trip-link").click();
  await page.getByTestId("trip-name-input").fill(name);
  if (endDate) await page.getByTestId("trip-end-date-input").fill(endDate);
  await page.getByTestId("create-trip-submit").click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/u);
  return page.url().split("/").at(-1)!;
}

export async function createTripWorkspace(page: Page, name: string) {
  const tripId = await createTrip(page, name);
  await page.getByRole("button", { name: /^Day 1,/u }).click();
  await expect(page.getByTestId("add-itinerary-item")).toBeVisible();
  for (let index = 0; index < 3; index += 1) {
    await page.getByTestId("add-itinerary-item").click();
    const editor = page.getByTestId("item-editor");
    await editor.getByTestId("item-name-input").fill(`地点${index + 1}`);
    await editor.getByTestId("save-item-button").click();
    await expect(page.getByTestId("itinerary-item").filter({
      has: page.getByRole("heading", { name: `地点${index + 1}`, exact: true }),
    })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByTestId("itinerary-item").filter({
    has: page.getByRole("heading", { name: "地点1", exact: true }),
  })).toBeVisible();
  return tripId;
}

export async function createLocatedTripWorkspace(page: Page, name: string) {
  const tripId = await createTrip(page, name);
  await page.getByRole("button", { name: /^Day 1,/u }).click();
  await expect(page.getByTestId("add-itinerary-item")).toBeVisible();
  const fixtures = [
    { target: "A", query: "外滩", mode: "" },
    { target: "B", query: "豫园", mode: "WALK" },
    { target: "C", query: "人民广场", mode: "METRO" },
  ];
  for (const fixture of fixtures) {
    await page.getByTestId("add-itinerary-item").click();
    const editor = page.getByTestId("item-editor");
    await editor.getByTestId("item-name-input").fill(fixture.target);
    await editor.getByTestId("location-text-input").fill(fixture.query);
    await editor.getByTestId("location-search-button").click();
    await editor.getByRole("radio").first().check();
    await editor.getByTestId("location-confirm-button").click();
    if (fixture.mode) await editor.getByLabel("Inbound transport mode").selectOption(fixture.mode);
    await editor.getByTestId("save-item-button").click();
    await expect(page.getByTestId("itinerary-item").filter({
      has: page.getByRole("heading", { name: fixture.target, exact: true }),
    })).toBeVisible();
  }
  await expect(page.getByRole("application", { name: "Route map" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Route list" }).getByRole("button")).toHaveCount(2, { timeout: 20_000 });
  return tripId;
}

export async function uploadImportFixture(page: Page, rowCount = 2) {
  const workspace = page.getByRole("region", { name: "导入映射工作台" });
  const rows = Array.from({ length: rowCount }, (_, index) =>
    index === rowCount - 1
      ? "0,"
      : `${(index % 5) + 1},事项${index + 1}`);
  await workspace.getByLabel("上传行程文件").setInputFiles({
    name: "m3-preview.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`Day,Target\n${rows.join("\n")}\n`),
  });
  await expect(
    workspace.getByRole("status").filter({ hasText: "已生成真实 ImportJob" }),
  ).toBeVisible({ timeout: 45_000 });
  await expect(workspace.getByRole("button", { name: "保存映射" })).toBeVisible();
}
