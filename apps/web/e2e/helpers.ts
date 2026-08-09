import { expect, type Page } from "@playwright/test";

async function createTrip(page: Page, name: string, endDate?: string) {
  await page.goto("/");
  await page.getByRole("link", { name: "创建我的旅行" }).click();
  await page.getByLabel("旅行名称").fill(name);
  if (endDate) await page.getByLabel("结束日期").fill(endDate);
  await page.getByRole("button", { name: "创建旅行" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/u);
  return page.url().split("/").at(-1)!;
}

export async function createTripWorkspace(page: Page, name: string) {
  const tripId = await createTrip(page, name);
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("button", { name: "新增 attraction" }).click();
    const editor = page.getByRole("form", { name: "新增事项" });
    await editor.getByLabel("事项名称").fill(`地点${index + 1}`);
    await editor.getByRole("button", { name: "保存事项" }).click();
    await expect(page.getByRole("button", { name: `编辑 地点${index + 1}` })).toBeVisible();
    await editor.getByRole("button", { name: "关闭" }).click();
  }
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByRole("button", { name: "地点1", exact: true })).toBeVisible();
  return tripId;
}

export async function createLocatedTripWorkspace(page: Page, name: string) {
  const tripId = await createTrip(page, name);
  const fixtures = [
    { target: "A", query: "外滩", mode: "" },
    { target: "B", query: "豫园", mode: "WALK" },
    { target: "C", query: "人民广场", mode: "METRO" },
  ];
  for (const fixture of fixtures) {
    await page.getByRole("button", { name: "新增 attraction" }).click();
    const editor = page.getByRole("form", { name: "新增事项" });
    await editor.getByLabel("事项名称").fill(fixture.target);
    await editor.getByLabel("地点文字").fill(fixture.query);
    await editor.getByRole("button", { name: "显式搜索地点" }).click();
    await editor.getByRole("radio").first().check();
    await editor.getByRole("button", { name: "确认候选地点" }).click();
    if (fixture.mode) await editor.getByLabel("入站交通方式").selectOption(fixture.mode);
    await editor.getByRole("button", { name: "保存事项" }).click();
    await expect(page.getByRole("button", { name: `编辑 ${fixture.target}` })).toBeVisible();
  }
  await expect(page.getByRole("application", { name: "真实地图路线" })).toBeVisible();
  await expect(page.getByRole("list", { name: "路线列表" }).getByRole("button")).toHaveCount(2, { timeout: 20_000 });
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
