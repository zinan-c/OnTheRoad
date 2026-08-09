import { expect, test } from "@playwright/test";

import { caseName, createSimpleItem, createTrip, selectDay, timelineLabels } from "./helpers";

test("E2E-007 — Trip date extension and empty-Day contraction", async ({ page }) => {
  const name = caseName("E2E-007", "date-preservation");
  await createTrip(page, {
    name,
    startDate: "2026-10-01",
    endDate: "2026-10-03",
  });
  await createSimpleItem(page, "Day 1 保留事项", { kind: "activity", day: 1 });
  await createSimpleItem(page, "Day 2 保留事项", { kind: "other", day: 2 });

  await page.getByRole("button", { name: "打开旅行设置" }).click();
  const dateForm = page.getByRole("form", { name: "旅行日期设置" });
  await dateForm.getByLabel("结束日期").fill("2026-10-05");
  await dateForm.getByRole("button", { name: "预览日期变更" }).click();
  const preview = dateForm.getByRole("region", { name: "日期变更预览" });
  await expect(preview).toContainText("变更后共 5 天");
  await expect(preview).toContainText("2026-10-04");
  await expect(preview).toContainText("2026-10-05");
  await preview.getByRole("button", { name: "确认应用日期变更" }).click();
  await expect(dateForm.getByRole("status")).toContainText("共 5 天");
  await page.reload();
  await expect(page.getByRole("navigation", { name: "选择 Day" }).getByRole("button")).toHaveCount(5);
  await selectDay(page, 1);
  await expect.poll(() => timelineLabels(page, 1)).toEqual(["Day 1 保留事项"]);
  await selectDay(page, 2);
  await expect.poll(() => timelineLabels(page, 2)).toEqual(["Day 2 保留事项"]);
  await selectDay(page, 3);
  await expect.poll(() => timelineLabels(page, 3)).toEqual([]);

  await page.getByRole("button", { name: "打开旅行设置" }).click();
  const contractionForm = page.getByRole("form", { name: "旅行日期设置" });
  await contractionForm.getByLabel("结束日期").fill("2026-10-03");
  await contractionForm.getByRole("button", { name: "预览日期变更" }).click();
  const contraction = contractionForm.getByRole("region", { name: "日期变更预览" });
  await expect(contraction).toContainText("移除 Day：2026-10-04、2026-10-05");
  await contraction.getByRole("button", { name: "确认应用日期变更" }).click();
  await expect(contractionForm.getByRole("status")).toContainText("共 3 天");
  await page.reload();
  await expect(page.getByRole("navigation", { name: "选择 Day" }).getByRole("button")).toHaveCount(3);
  await selectDay(page, 1);
  await expect.poll(() => timelineLabels(page, 1)).toEqual(["Day 1 保留事项"]);
  await selectDay(page, 2);
  await expect.poll(() => timelineLabels(page, 2)).toEqual(["Day 2 保留事项"]);
});

test("E2E-008 — Trip update, soft delete and restore lifecycle", async ({ page }) => {
  const originalName = caseName("E2E-008", "待修改旅行");
  const updatedName = `${originalName} 已确认旅行`;
  const tripId = await createTrip(page, { name: originalName });
  await createSimpleItem(page, "生命周期保留事项", { kind: "attraction" });

  await page.getByRole("button", { name: "打开旅行设置" }).click();
  const settings = page.getByRole("form", { name: "旅行基本设置" });
  await settings.getByLabel("旅行名称").fill(updatedName);
  await settings.getByLabel("旅行描述").fill("Lifecycle 已确认；中英文 mixed description。");
  await settings.getByLabel("同行人数").fill("4");
  await settings.getByLabel("预算").fill("12000.50");
  await settings.getByLabel("默认币种").selectOption("EUR");
  await settings.getByLabel("时区").fill("Asia/Shanghai");
  await settings.getByLabel("地图配置").selectOption("cn_primary");
  await settings.getByRole("button", { name: "保存基本设置" }).click();
  await expect(page.getByRole("status").filter({ hasText: "基本设置已保存" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: updatedName })).toBeVisible();
  await page.getByRole("button", { name: "打开旅行设置" }).click();
  const refreshed = page.getByRole("form", { name: "旅行基本设置" });
  await expect(refreshed.getByLabel("旅行描述")).toHaveValue("Lifecycle 已确认；中英文 mixed description。");
  await expect(refreshed.getByLabel("同行人数")).toHaveValue("4");
  await expect(refreshed.getByLabel("预算")).toHaveValue("12000.50");
  await expect(refreshed.getByLabel("默认币种")).toHaveValue("EUR");

  const danger = page.getByRole("region", { name: "删除旅行" });
  await danger.getByRole("button", { name: "删除旅行" }).click();
  await danger.getByRole("button", { name: "确认删除" }).click();
  await expect(page).toHaveURL(/\/trips$/u);
  await expect(page.getByRole("list", { name: "进行中的旅行" }).getByText(updatedName)).toHaveCount(0);
  await page.getByRole("tab", { name: "回收站" }).click();
  const recycleBin = page.getByRole("list", { name: "已删除的旅行" });
  await expect(recycleBin.getByRole("heading", { name: updatedName })).toBeVisible();
  await recycleBin.getByRole("listitem").filter({ hasText: updatedName }).getByRole("button", { name: "恢复旅行" }).click();
  await expect(page.getByRole("status")).toContainText(`已恢复“${updatedName}”`);
  await expect(page.getByRole("list", { name: "进行中的旅行" }).getByRole("heading", { name: updatedName })).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: updatedName }).getByRole("link", { name: "打开旅行" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}$`, "u"));
  await page.reload();
  await expect(page.getByRole("button", { name: "编辑 生命周期保留事项" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "选择 Day" }).getByRole("button")).toHaveCount(5);
});
