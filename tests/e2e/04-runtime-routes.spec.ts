import { expect, test } from "@playwright/test";

import {
  caseName,
  createLocatedSequence,
  createTrip,
  openItem,
  openNewItem,
  resolveLocation,
  saveNewItem,
  saveTextLocation,
  selectDay,
} from "./helpers";

test("E2E-016 — full runtime DirectionsProvider-to-MapLibre happy path", async ({ page }) => {
  const tileRequest = page.waitForResponse((response) =>
    response.ok() && new URL(response.url()).pathname.startsWith("/api/map/tiles/"));
  await createTrip(page, { name: caseName("E2E-016", "runtime-route") });
  await createLocatedSequence(page, [
    { target: "A", query: "外滩" },
    { target: "B", query: "豫园", mode: "WALK" },
  ]);
  const editor = await openNewItem(page, "attraction");
  await editor.getByLabel("事项名称").fill("C");
  await resolveLocation(editor, "人民广场");
  await editor.getByLabel("入站交通方式").selectOption("METRO");
  const generating = expect(page.getByRole("status").filter({ hasText: "路线生成中" })).toBeVisible();
  await saveNewItem(editor, "C");
  await generating;
  const map = page.getByRole("application", { name: "真实地图路线" });
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute("data-route-count", "2", { timeout: 30_000 });
  await tileRequest;
  await expect(page.getByText("地图数据 © On The Road fixture", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "路线交通方式图例" })).toContainText("步行");
  await expect(page.getByRole("list", { name: "路线交通方式图例" })).toContainText("地铁");

  const timelineB = page.getByRole("list", { name: "行程时间线" }).getByRole("button", { name: "B", exact: true });
  await timelineB.click();
  await expect(timelineB).toHaveAttribute("aria-pressed", "true");
  await map.getByRole("button", { name: /C$/u }).click();
  await expect(page.getByRole("list", { name: "行程时间线" }).getByRole("button", { name: "C", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("list", { name: "路线列表" }).getByRole("button").filter({ hasText: "A → B" }).click();
  const details = page.getByRole("complementary", { name: "路线详情" });
  await expect(details).toContainText("步行");
  await expect(details).toContainText("fixture");
  await expect(details).toContainText("真实路线");
  await expect(details).toContainText("→");

  await page.reload();
  await expect(map).toHaveAttribute("data-route-count", "2", { timeout: 30_000 });
  await page.getByRole("list", { name: "行程时间线" }).getByRole("button", { name: "B", exact: true }).click();
  await map.getByRole("button", { name: /C$/u }).click();
  await page.getByRole("list", { name: "路线列表" }).getByRole("button").filter({ hasText: "A → B" }).click();
  await expect(page.getByRole("complementary", { name: "路线详情" })).toContainText("fixture");
});

test("E2E-017 — cross-day and transport-internal route matrix", async ({ page }) => {
  await createTrip(page, {
    name: caseName("E2E-017", "route-matrix"),
    startDate: "2026-10-01",
    endDate: "2026-10-02",
  });
  await page.getByRole("button", { name: "交通方式设置" }).click();
  const manager = page.getByRole("region", { name: "交通方式管理" });
  await manager.getByLabel("交通方式 Code").fill("CABLE_SHUTTLE_CUSTOM");
  await manager.getByLabel("交通方式名称").fill("缆车接驳");
  await manager.getByLabel("交通方式颜色").fill("#123456");
  await manager.getByLabel("交通方式线型").selectOption("dotted");
  await manager.getByLabel("交通方式图标").fill("cable-car");
  await manager.getByRole("button", { name: "新增交通方式" }).click();

  await createLocatedSequence(page, [
    { target: "A", query: "外滩", day: 1, mode: "WALK" },
    { target: "B", query: "豫园", day: 1, mode: "FLIGHT" },
    { target: "C", query: "人民广场", day: 2, mode: "FERRY" },
  ]);
  let editor = await openNewItem(page, "transport");
  await editor.getByLabel("事项名称").fill("D");
  await resolveLocation(editor, "外滩", { legend: "交通起点", inputLabel: "起点地点文字" });
  await resolveLocation(editor, "豫园", { legend: "交通终点", inputLabel: "终点地点文字" });
  await editor.getByLabel("交通方式").selectOption("CABLE_SHUTTLE_CUSTOM");
  await saveNewItem(editor, "D");
  await createLocatedSequence(page, [{ target: "E", query: "外滩", day: 2, mode: "PUBLIC_BUS" }]);
  editor = await openNewItem(page, "attraction");
  await editor.getByLabel("事项名称").fill("F");
  await saveTextLocation(editor, "尚未确认的 F");
  await editor.getByLabel("入站交通方式").selectOption("WALK");
  await saveNewItem(editor, "F");

  const routeList = page.getByRole("list", { name: "路线列表" });
  await expect(routeList.getByRole("button")).toHaveCount(6, { timeout: 30_000 });
  await expect(routeList).toContainText("Transport 内部路线");
  await expect(routeList).toContainText("真实路线");
  await page.getByRole("button", { name: "Day 1", exact: true }).last().click();
  await expect(routeList).toContainText("A → B");
  await page.getByRole("button", { name: "Day 2", exact: true }).last().click();
  await expect(routeList).toContainText("B → C");
  await expect(routeList).toContainText("D → D");
  await page.getByRole("button", { name: "全局地图" }).click();

  await selectDay(page, 1);
  await page.getByRole("button", { name: "上移 B" }).click();
  await expect(page.getByRole("status").filter({ hasText: "已将 B移动到第 1 位" })).toBeVisible();
  editor = await openItem(page, "A");
  await editor.getByLabel("入站交通方式").selectOption("PUBLIC_BUS");
  await expect(editor.locator("footer").getByRole("status")).toHaveText("已保存", { timeout: 20_000 });
  await editor.getByRole("button", { name: "关闭" }).click();
  await expect(page.getByRole("status").filter({ hasText: "路线生成中" })).toBeVisible();
  await expect(routeList).toContainText("B → A", { timeout: 30_000 });
  const gaps = page.getByRole("complementary", { name: "路线缺口" });
  await expect(gaps).toContainText("F", { timeout: 30_000 });
  await expect(gaps).toContainText(/未确认|尚未确认/u);
  await page.reload();
  await expect(page.getByRole("list", { name: "路线列表" })).toContainText("B → A", { timeout: 30_000 });
  await expect(page.getByRole("complementary", { name: "路线缺口" })).toContainText("F");
});
