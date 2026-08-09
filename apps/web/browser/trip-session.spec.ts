import { expect, test } from "@playwright/test";

test("TC-B04-03 creates a Trip and Item through the UI and restores its session", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText(/服务已就绪/u)).toBeVisible();
  await page.getByRole("link", { name: "创建我的旅行" }).click();

  await expect(page.getByRole("heading", { name: "创建一段新旅程" })).toBeVisible();
  await page.getByLabel("旅行名称").fill("Playwright 东海之旅");
  await expect(page.getByText("将自动生成 5 天计划")).toBeVisible();
  await page.getByRole("button", { name: "创建旅行" }).click();

  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/u);
  await expect(page.getByRole("heading", { name: "Playwright 东海之旅" })).toBeVisible();
  await page.getByRole("button", { name: "新增 attraction" }).click();
  const editor = page.getByRole("form", { name: "新增事项" });
  await editor.getByLabel("事项名称").fill("外滩夜景");
  await editor.getByLabel("地点文字").fill("外滩");
  await editor.getByRole("button", { name: "显式搜索地点" }).click();
  await editor.getByRole("radio").first().check();
  await editor.getByRole("button", { name: "确认候选地点" }).click();
  await expect(editor.getByText(/地点状态：resolved/u)).toBeVisible();
  await editor.getByRole("button", { name: "保存事项" }).click();
  await expect(page.getByRole("button", { name: "编辑 外滩夜景" })).toBeVisible();
  await editor.getByRole("button", { name: "关闭" }).click();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Playwright 东海之旅" })).toBeVisible();
  await expect(page.getByRole("button", { name: "编辑 外滩夜景" })).toBeVisible();

  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("heading", { name: "会话已退出" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "会话已退出" })).toBeVisible();
  await page.getByRole("button", { name: "重新登录" }).click();
  await expect(page.getByRole("heading", { name: "Playwright 东海之旅" })).toBeVisible();
});

test("REVIEW-P1-04 keeps the core creation path usable at the project viewport", async ({
  page,
}, testInfo) => {
  await page.goto("/trips/new");
  await expect(page.getByRole("form", { name: "新建旅行" })).toBeVisible();
  const viewport = page.viewportSize();
  if (testInfo.project.name === "mobile-chromium") {
    expect(viewport?.width).toBeLessThanOrEqual(420);
    await expect(page.getByLabel("旅行名称")).toBeInViewport();
    const submit = page.getByRole("button", { name: "创建旅行" });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
  }
});
