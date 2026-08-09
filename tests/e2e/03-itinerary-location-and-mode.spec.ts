import { devices, expect, test, type Locator, type Page } from "@playwright/test";

import {
  caseName,
  createSimpleItem,
  createTrip,
  openItem,
  openNewItem,
  resolveLocation,
  saveNewItem,
  saveTextLocation,
  selectDay,
  timelineLabels,
} from "./helpers";

test("E2E-009 — complete Itinerary Item type and field matrix", async ({ page }) => {
  await createTrip(page, { name: caseName("E2E-009", "item-matrix") });

  let editor = await openNewItem(page, "activity");
  await editor.getByLabel("事项名称").fill("晨间活动");
  await editor.getByLabel("描述").fill("城市热身活动");
  await editor.getByLabel("时间类型").selectOption("clock");
  await editor.getByLabel("开始时间").fill("09:00");
  await editor.getByLabel("时长（分钟）").fill("60");
  await editor.getByLabel("备注").fill("带水");
  await saveNewItem(editor, "晨间活动");

  editor = await openNewItem(page, "attraction");
  await editor.getByLabel("事项名称").fill("东方明珠");
  await editor.getByLabel("时间类型").selectOption("period");
  await editor.locator('select:has(option[value="morning"])').selectOption("morning");
  await resolveLocation(editor, "人民广场", { candidate: /上海/u });
  await saveNewItem(editor, "东方明珠");

  editor = await openNewItem(page, "dining");
  await editor.getByLabel("事项名称").fill("午餐");
  await editor.getByLabel("时间类型").selectOption("range");
  await editor.getByLabel("开始时间").fill("12:00");
  await editor.getByLabel("结束时间").fill("13:15");
  await editor.getByLabel("餐厅").fill("本帮餐厅");
  await editor.getByLabel("餐别").selectOption("lunch");
  await fillBooking(editor, "DINING-001", "王女士", "13800000001");
  await saveNewItem(editor, "午餐");

  editor = await openNewItem(page, "accommodation");
  await editor.getByLabel("事项名称").fill("外滩酒店");
  await editor.getByLabel("时间类型").selectOption("range");
  await editor.getByLabel("开始时间").fill("22:30");
  await editor.getByLabel("结束时间").fill("07:30");
  await editor.getByText("跨午夜").getByRole("checkbox").check();
  await editor.getByLabel("住宿名称").fill("外滩酒店");
  await editor.getByLabel("住宿详情").fill("大床房");
  await editor.getByLabel("入住日期").fill("2026-10-01");
  await editor.getByLabel("退房日期").fill("2026-10-02");
  await saveNewItem(editor, "外滩酒店");

  editor = await openNewItem(page, "transport");
  await editor.getByLabel("事项名称").fill("地铁接驳");
  await editor.getByLabel("时间类型").selectOption("range");
  await editor.getByLabel("开始时间").fill("14:00");
  await editor.getByLabel("结束时间").fill("15:00");
  await resolveLocation(editor, "外滩", { legend: "交通起点", inputLabel: "起点地点文字" });
  await resolveLocation(editor, "豫园", { legend: "交通终点", inputLabel: "终点地点文字" });
  await editor.getByLabel("交通方式").selectOption("METRO");
  await fillBooking(editor, "METRO-001", "李先生", "13800000002");
  await saveNewItem(editor, "地铁接驳");

  editor = await openNewItem(page, "other");
  await editor.getByLabel("事项名称").fill("自由安排");
  await editor.getByLabel("时间类型").selectOption("unscheduled");
  await saveNewItem(editor, "自由安排");

  expect(await timelineLabels(page, 1)).toEqual(["晨间活动", "东方明珠", "午餐", "外滩酒店", "地铁接驳", "自由安排"]);
  await assertItemFields(page);
  await page.reload();
  await expect.poll(() => timelineLabels(page, 1)).toEqual(["晨间活动", "东方明珠", "午餐", "外滩酒店", "地铁接驳", "自由安排"]);
  await assertItemFields(page);
});

test("E2E-010 — Item edit, autosave and reload", async ({ page }) => {
  await createTrip(page, { name: caseName("E2E-010", "autosave") });
  await createSimpleItem(page, "待编辑景点", { kind: "attraction" });
  const editor = await openItem(page, "待编辑景点");
  await editor.getByLabel("事项名称").fill("外滩日出");
  await expect(editor.locator("footer").getByRole("status")).toHaveText("有未保存更改");
  await editor.getByLabel("描述").fill("描述一");
  await editor.getByLabel("描述").fill("描述二");
  await editor.getByLabel("描述").fill("最终描述");
  await editor.getByLabel("时间类型").selectOption("range");
  await editor.getByLabel("开始时间").fill("06:00");
  await editor.getByLabel("结束时间").fill("07:15");
  await editor.getByLabel("时长（分钟）").fill("75");
  await resolveLocation(editor, "外滩");
  await editor.getByRole("group", { name: "费用" }).getByLabel("金额").fill("88.50");
  await editor.getByRole("group", { name: "费用" }).getByLabel("币种").fill("CNY");
  await editor.getByRole("group", { name: "费用" }).getByLabel("类别").fill("TICKET");
  await editor.getByLabel("备注").fill("最终备注");
  await expect(editor.locator("footer").getByRole("status")).toHaveText("已保存", { timeout: 20_000 });

  await editor.getByLabel("描述").fill("触发离开提醒");
  let promptMessage = "";
  page.once("dialog", async (prompt) => {
    promptMessage = prompt.message();
    await prompt.dismiss();
  });
  await editor.getByRole("button", { name: "关闭" }).click();
  expect(promptMessage).toContain("未保存");
  await expect(editor).toBeVisible();
  await editor.getByLabel("描述").fill("最终描述");
  await expect(editor.locator("footer").getByRole("status")).toHaveText("已保存", { timeout: 20_000 });
  await page.reload();
  const reloaded = await openItem(page, "外滩日出");
  await expect(reloaded.getByLabel("描述")).toHaveValue("最终描述");
  await expect(reloaded.getByLabel("开始时间")).toHaveValue("06:00");
  await expect(reloaded.getByLabel("结束时间")).toHaveValue("07:15");
  await expect(reloaded.getByLabel("时长（分钟）")).toHaveValue("75");
  await expect(reloaded.getByLabel("备注")).toHaveValue("最终备注");
  await expect(reloaded.getByRole("group", { name: "费用" }).getByLabel("金额")).toHaveValue("88.5");
  await expect(reloaded.getByRole("group", { name: "地点" }).getByText(/地点状态：resolved/u)).toBeVisible();
});

test("E2E-011 — copy, edit copied Item and soft delete", async ({ page }) => {
  await createTrip(page, { name: caseName("E2E-011", "copy-delete") });
  await createSimpleItem(page, "早餐", { kind: "dining", day: 1 });
  await page.getByLabel("复制 早餐 到").selectOption({ label: "Day 2" });
  await selectDay(page, 2);
  await expect(page.getByRole("button", { name: "编辑 早餐" })).toBeVisible();
  let editor = await openItem(page, "早餐");
  await editor.getByLabel("事项名称").fill("早餐（复制后修改）");
  await editor.getByLabel("备注").fill("副本已修改");
  await expect(editor.locator("footer").getByRole("status")).toHaveText("已保存", { timeout: 20_000 });
  await editor.getByRole("button", { name: "关闭" }).click();

  await selectDay(page, 1);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "删除 早餐" }).click();
  await expect(page.getByRole("button", { name: "编辑 早餐" })).toHaveCount(0);
  await page.reload();
  await selectDay(page, 1);
  await expect.poll(() => timelineLabels(page, 1)).toEqual([]);
  await selectDay(page, 2);
  await expect.poll(() => timelineLabels(page, 2)).toEqual(["早餐（复制后修改）"]);
  editor = await openItem(page, "早餐（复制后修改）");
  await expect(editor.getByLabel("备注")).toHaveValue("副本已修改");
});

test("E2E-012 — same-day reorder across mouse, keyboard and touch", async ({ page, browser }) => {
  const tripId = await createTrip(page, { name: caseName("E2E-012", "reorder") });
  for (const target of ["A", "B", "C", "D"]) await createSimpleItem(page, target, { kind: "attraction" });
  await dragBefore(page, "B", "A");
  await dragBefore(page, "D", "C");
  await expect.poll(() => timelineLabels(page, 1)).toEqual(["B", "A", "D", "C"]);
  await page.reload();
  await expect.poll(() => timelineLabels(page, 1)).toEqual(["B", "A", "D", "C"]);
  const keyboardReorder = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/itinerary-items/reorder"));
  await page.getByRole("button", { name: "上移 D" }).click();
  await expect(page.getByRole("status").filter({ hasText: "已将 D移动到第 2 位" })).toBeVisible();
  expect((await keyboardReorder).ok()).toBe(true);
  await expect.poll(() => timelineLabels(page, 1)).toEqual(["B", "D", "A", "C"]);

  const mobileContext = await browser.newContext({ ...devices["Pixel 7"] });
  const mobile = await mobileContext.newPage();
  await mobile.goto(`/trips/${tripId}`);
  await mobile.getByRole("button", { name: "重新登录" }).click();
  await expect(mobile.getByRole("button", { name: "编辑 B" })).toBeVisible();
  const touchReorder = mobile.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/itinerary-items/reorder"));
  await mobile.getByRole("button", { name: "下移 B" }).click();
  await expect(mobile.getByRole("status").filter({ hasText: "已将 B移动到第 2 位" })).toBeVisible();
  expect((await touchReorder).ok()).toBe(true);
  await mobile.reload();
  await expect.poll(() => timelineLabels(mobile, 1)).toEqual(["D", "B", "A", "C"]);
  await mobileContext.close();
});

test("E2E-013 — custom transport mode lifecycle", async ({ page }) => {
  await createTrip(page, { name: caseName("E2E-013", "custom-mode") });
  await page.getByRole("button", { name: "交通方式设置" }).click();
  const manager = page.getByRole("region", { name: "交通方式管理" });
  await manager.getByLabel("交通方式 Code").fill("CABLE_SHUTTLE_CUSTOM");
  await manager.getByLabel("交通方式名称").fill("缆车接驳");
  await manager.getByLabel("交通方式颜色").fill("#123456");
  await manager.getByLabel("交通方式线型").selectOption("dotted");
  await manager.getByLabel("交通方式图标").fill("cable-car");
  await manager.getByRole("button", { name: "新增交通方式" }).click();
  await expect(manager.getByText("CABLE_SHUTTLE_CUSTOM")).toBeVisible();

  const editor = await openNewItem(page, "transport");
  await editor.getByLabel("事项名称").fill("缆车段");
  await resolveLocation(editor, "外滩", { legend: "交通起点", inputLabel: "起点地点文字" });
  await resolveLocation(editor, "豫园", { legend: "交通终点", inputLabel: "终点地点文字" });
  await editor.getByLabel("交通方式").selectOption("CABLE_SHUTTLE_CUSTOM");
  await saveNewItem(editor, "缆车段");
  await expect(page.getByRole("list", { name: "路线交通方式图例" })).toContainText("缆车接驳");
  await page.reload();
  const existing = await openItem(page, "缆车段");
  await expect(existing.getByLabel("交通方式")).toHaveValue("CABLE_SHUTTLE_CUSTOM");
  await existing.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: "交通方式设置" }).click();
  await page.getByRole("button", { name: "停用 缆车接驳" }).click();
  const retained = await openItem(page, "缆车段");
  await expect(retained.getByLabel("交通方式").locator("option:checked")).toContainText("已停用");
  await retained.getByRole("button", { name: "关闭" }).click();
  const fresh = await openNewItem(page, "transport");
  await expect(fresh.getByLabel("交通方式").locator('option[value="CABLE_SHUTTLE_CUSTOM"]')).toHaveCount(0);
});

test("E2E-014 — explicit location search, candidate confirmation and persistence", async ({ page }) => {
  await createTrip(page, { name: caseName("E2E-014", "location-confirmation") });
  const editor = await openNewItem(page, "attraction");
  await editor.getByLabel("事项名称").fill("人民广场散步");
  const location = editor.getByRole("group", { name: "地点" });
  await location.getByLabel("地点文字").fill("人民广场");
  await location.getByRole("button", { name: "显式搜索地点" }).click();
  const candidates = location.getByRole("radiogroup", { name: "地点候选" });
  await expect(candidates.getByRole("radio")).toHaveCount(2);
  await expect(candidates).toContainText("上海");
  await expect(candidates).toContainText("重庆");
  await expect(candidates).toContainText("fixture");
  await editor.getByLabel("描述").focus();
  await expect(candidates.getByRole("radio").first()).not.toBeChecked();
  await candidates.locator("label").filter({ hasText: /上海/u }).getByRole("radio").check();
  await location.getByRole("button", { name: "确认候选地点" }).click();
  await expect(location.getByText(/地点状态：resolved/u)).toBeVisible();
  await saveNewItem(editor, "人民广场散步");
  await page.reload();
  const reloaded = await openItem(page, "人民广场散步");
  await expect(reloaded.getByRole("group", { name: "地点" }).getByText(/地点状态：resolved.*上海市黄浦区/u)).toBeVisible();
});

test("E2E-015 — map pick, Marker drag and manual coordinate persistence", async ({ page }) => {
  await createTrip(page, { name: caseName("E2E-015", "coordinate-priority") });
  const editor = await openNewItem(page, "attraction");
  await editor.getByLabel("事项名称").fill("外滩附近");
  await saveTextLocation(editor, "外滩附近");
  const coordinates = editor.getByRole("region", { name: "Location 坐标调整" });
  await expect(coordinates.getByRole("status")).toContainText("未解析");
  await coordinates.getByText("键盘精确操作地图与 Marker").click();
  await coordinates.getByLabel("地图操作经度").fill("121.4900");
  await coordinates.getByLabel("地图操作纬度").fill("31.2400");
  await coordinates.getByRole("button", { name: "保存地图点选" }).click();
  await expect(coordinates.getByRole("status")).toContainText("121.49, 31.24");
  await coordinates.getByLabel("地图操作经度").fill("121.5000");
  await coordinates.getByLabel("地图操作纬度").fill("31.2300");
  await coordinates.getByRole("button", { name: "保存 Marker 拖动位置" }).click();
  await expect(coordinates.getByRole("status")).toContainText("121.5, 31.23");
  await coordinates.getByLabel("手工 longitude").fill("121.5100");
  await coordinates.getByLabel("手工 latitude").fill("31.2200");
  await coordinates.getByRole("button", { name: "保存手工坐标" }).click();
  await expect(coordinates.getByRole("status")).toContainText("121.51, 31.22");
  await expect(coordinates.getByRole("status")).toContainText("人工调整");
  await saveNewItem(editor, "外滩附近");
  await page.reload();
  const reloaded = await openItem(page, "外滩附近");
  await expect(reloaded.getByRole("region", { name: "Location 坐标调整" }).getByRole("status")).toContainText("121.51, 31.22");
});

async function fillBooking(editor: Locator, reference: string, contact: string, phone: string) {
  await editor.getByLabel("预订编号").fill(reference);
  await editor.getByLabel("联系人").fill(contact);
  await editor.getByLabel("联系电话").fill(phone);
}

async function assertItemFields(page: Page) {
  let editor = await openItem(page, "晨间活动");
  await expect(editor.getByLabel("开始时间")).toHaveValue("09:00");
  await expect(editor.getByLabel("时长（分钟）")).toHaveValue("60");
  await editor.getByRole("button", { name: "关闭" }).click();
  editor = await openItem(page, "东方明珠");
  await expect(editor.locator('select:has(option[value="morning"])')).toHaveValue("morning");
  await expect(editor.getByRole("group", { name: "地点" }).getByText(/地点状态：resolved/u)).toBeVisible();
  await editor.getByRole("button", { name: "关闭" }).click();
  editor = await openItem(page, "午餐");
  await expect(editor.getByLabel("餐厅")).toHaveValue("本帮餐厅");
  await expect(editor.getByLabel("餐别")).toHaveValue("lunch");
  await expect(editor.getByLabel("预订编号")).toHaveValue("DINING-001");
  await editor.getByRole("button", { name: "关闭" }).click();
  editor = await openItem(page, "外滩酒店");
  await expect(editor.getByText("跨午夜").getByRole("checkbox")).toBeChecked();
  await expect(editor.getByLabel("住宿详情")).toHaveValue("大床房");
  await editor.getByRole("button", { name: "关闭" }).click();
  editor = await openItem(page, "地铁接驳");
  await expect(editor.getByLabel("交通方式")).toHaveValue("METRO");
  await expect(editor.getByLabel("预订编号")).toHaveValue("METRO-001");
  await editor.getByRole("button", { name: "关闭" }).click();
  editor = await openItem(page, "自由安排");
  await expect(editor.getByLabel("时间类型")).toHaveValue("unscheduled");
  await editor.getByRole("button", { name: "关闭" }).click();
}

async function dragBefore(page: Page, source: string, target: string) {
  const from = page.getByRole("button", { name: `拖动 ${source}` });
  const to = page.getByRole("button", { name: `拖动 ${target}` });
  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  if (!fromBox || !toBox) throw new Error(`Unable to drag ${source} before ${target}`);
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + 2, { steps: 12 });
  await page.mouse.up();
}
