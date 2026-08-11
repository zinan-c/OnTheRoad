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
  waitForAutosave,
} from "./helpers";

test("E2E-009 — complete Itinerary Item type and field matrix", async ({ page }) => {
  await createTrip(page, { name: caseName("E2E-009", "item-matrix") });

  let editor = await openNewItem(page, "activity");
  await editor.getByLabel("Item name").fill("晨间活动");
  await editor.getByLabel("Description").fill("城市热身活动");
  await editor.getByLabel("Time type").selectOption("clock");
  await editor.getByLabel("Start time").fill("09:00");
  await editor.getByLabel("Duration (minutes)").fill("60");
  await editor.getByLabel("Notes").fill("带水");
  await saveNewItem(editor, "晨间活动");

  editor = await openNewItem(page, "attraction");
  await editor.getByLabel("Item name").fill("东方明珠");
  await editor.getByLabel("Time type").selectOption("period");
  await editor.locator('select:has(option[value="morning"])').selectOption("morning");
  await resolveLocation(editor, "人民广场", { candidate: /上海/u });
  await saveNewItem(editor, "东方明珠");

  editor = await openNewItem(page, "dining");
  await editor.getByLabel("Item name").fill("午餐");
  await editor.getByLabel("Time type").selectOption("range");
  await editor.getByLabel("Start time").fill("12:00");
  await editor.getByLabel("End time").fill("13:15");
  await editor.getByLabel("Restaurant").fill("本帮餐厅");
  await editor.getByLabel("Meal").selectOption("lunch");
  await fillBooking(editor, "DINING-001", "王女士", "13800000001");
  await saveNewItem(editor, "午餐");

  editor = await openNewItem(page, "accommodation");
  await editor.getByLabel("Item name").fill("外滩酒店");
  await editor.getByLabel("Time type").selectOption("range");
  await editor.getByLabel("Start time").fill("22:30");
  await editor.getByLabel("End time").fill("07:30");
  await editor.getByText("Crosses midnight").getByRole("checkbox").check();
  await editor.getByLabel("Property name").fill("外滩酒店");
  await editor.getByLabel("Details").fill("大床房");
  await editor.getByLabel("Check-in date").fill("2026-10-01");
  await editor.getByLabel("Check-out date").fill("2026-10-02");
  await saveNewItem(editor, "外滩酒店");

  editor = await openNewItem(page, "transport");
  await editor.getByLabel("Item name").fill("地铁接驳");
  await editor.getByLabel("Time type").selectOption("range");
  await editor.getByLabel("Start time").fill("14:00");
  await editor.getByLabel("End time").fill("15:00");
  await resolveLocation(editor, "外滩", { legend: "Transport origin", inputLabel: "Origin location" });
  await resolveLocation(editor, "豫园", { legend: "Transport destination", inputLabel: "Destination location" });
  await editor.getByLabel("Transport mode").selectOption("METRO");
  await fillBooking(editor, "METRO-001", "李先生", "13800000002");
  await saveNewItem(editor, "地铁接驳");

  editor = await openNewItem(page, "other");
  await editor.getByLabel("Item name").fill("自由安排");
  await editor.getByLabel("Time type").selectOption("unscheduled");
  await saveNewItem(editor, "自由安排");

  expect(await timelineLabels(page, 1)).toEqual(["晨间活动", "东方明珠", "午餐", "外滩酒店", "地铁接驳", "自由安排"]);
  await assertItemFields(page);
  await page.reload();
  await expect.poll(() => timelineLabels(page, 1)).toEqual(["晨间活动", "东方明珠", "午餐", "外滩酒店", "地铁接驳", "自由安排"]);
  await assertItemFields(page);
});

test("E2E-010 — explicit Item save and reload", async ({ page }) => {
  await createTrip(page, { name: caseName("E2E-010", "autosave") });
  await createSimpleItem(page, "待编辑景点", { kind: "attraction" });
  const editor = await openItem(page, "待编辑景点");
  await editor.getByLabel("Item name").fill("外滩日出");
  await expect(editor.locator("footer").getByRole("status")).toHaveText("Unsaved changes");
  await editor.getByLabel("Description").fill("描述一");
  await editor.getByLabel("Description").fill("描述二");
  await editor.getByLabel("Description").fill("最终描述");
  await editor.getByLabel("Time type").selectOption("range");
  await editor.getByLabel("Start time").fill("06:00");
  await editor.getByLabel("End time").fill("07:15");
  await editor.getByLabel("Duration (minutes)").fill("75");
  await resolveLocation(editor, "外滩");
  await editor.getByRole("group", { name: "Expense" }).getByLabel("Amount").fill("88.50");
  await editor.getByRole("group", { name: "Expense" }).getByLabel("Currency").fill("CNY");
  await editor.getByRole("group", { name: "Expense" }).getByLabel("Expense remark").fill("Sunrise tickets");
  await editor.getByLabel("Notes").fill("最终备注");
  await waitForAutosave(editor);

  await editor.getByLabel("Description").fill("触发离开提醒");
  let promptMessage = "";
  page.once("dialog", async (prompt) => {
    promptMessage = prompt.message();
    await prompt.dismiss();
  });
  await editor.getByRole("button", { name: "Cancel" }).first().click();
  expect(promptMessage).toContain("unsaved changes");
  await expect(editor).toBeVisible();
  await editor.getByLabel("Description").fill("最终描述");
  await waitForAutosave(editor);
  await page.reload();
  const reloaded = await openItem(page, "外滩日出");
  await expect(reloaded.getByLabel("Description")).toHaveValue("最终描述");
  await expect(reloaded.getByLabel("Start time")).toHaveValue("06:00");
  await expect(reloaded.getByLabel("End time")).toHaveValue("07:15");
  await expect(reloaded.getByLabel("Duration (minutes)")).toHaveValue("75");
  await expect(reloaded.getByLabel("Notes")).toHaveValue("最终备注");
  await expect(reloaded.getByRole("group", { name: "Expense" }).getByLabel("Amount")).toHaveValue("88.5");
  await expect(reloaded.getByRole("group", { name: "Location" }).getByText(/Location status: resolved/u)).toBeVisible();
});

test("E2E-011 — copy, edit copied Item and soft delete", async ({ page }) => {
  await createTrip(page, { name: caseName("E2E-011", "copy-delete") });
  await createSimpleItem(page, "早餐", { kind: "dining", day: 1 });
  await page.getByLabel("Copy 早餐 to").selectOption({ label: "Day 2" });
  await selectDay(page, 2);
  await expect(page.getByRole("button", { name: "Edit 早餐" })).toBeVisible();
  let editor = await openItem(page, "早餐");
  await editor.getByLabel("Item name").fill("早餐（复制后修改）");
  await editor.getByLabel("Notes").fill("副本已修改");
  await waitForAutosave(editor);
  await editor.getByRole("button", { name: "Cancel" }).first().click();

  await selectDay(page, 1);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete 早餐" }).click();
  await expect(page.getByRole("button", { name: "Edit 早餐" })).toHaveCount(0);
  await page.reload();
  await selectDay(page, 1);
  await expect.poll(() => timelineLabels(page, 1)).toEqual([]);
  await selectDay(page, 2);
  await expect.poll(() => timelineLabels(page, 2)).toEqual(["早餐（复制后修改）"]);
  editor = await openItem(page, "早餐（复制后修改）");
  await expect(editor.getByLabel("Notes")).toHaveValue("副本已修改");
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
  await page.getByRole("button", { name: "Move D up" }).click();
  await expect(page.getByRole("status").filter({ hasText: "D moved to position 2" })).toBeVisible();
  expect((await keyboardReorder).ok()).toBe(true);
  await expect.poll(() => timelineLabels(page, 1)).toEqual(["B", "D", "A", "C"]);

  const mobileContext = await browser.newContext({ ...devices["Pixel 7"] });
  const mobile = await mobileContext.newPage();
  await mobile.goto(`/trips/${tripId}`);
  await mobile.getByRole("button", { name: "Sign in again" }).click();
  await expect(mobile.getByRole("button", { name: "Edit B" })).toBeVisible();
  const touchReorder = mobile.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/itinerary-items/reorder"));
  await mobile.getByRole("button", { name: "Move B down" }).click();
  await expect(mobile.getByRole("status").filter({ hasText: "B moved to position 2" })).toBeVisible();
  expect((await touchReorder).ok()).toBe(true);
  await mobile.reload();
  await expect.poll(() => timelineLabels(mobile, 1)).toEqual(["D", "B", "A", "C"]);
  await mobileContext.close();
});

test("E2E-013 — built-in transport modes stay available without settings UI", async ({ page }) => {
  await createTrip(page, { name: caseName("E2E-013", "built-in-mode") });
  await expect(page.getByRole("button", { name: "Transport modes" })).toHaveCount(0);
  const editor = await openNewItem(page, "transport");
  const modes = editor.getByLabel("Transport mode");
  await expect(modes.locator('option[value="WALK"]')).toHaveCount(1);
  await expect(modes.locator('option[value="CABLE_CAR"]')).toHaveCount(1);
  await expect(modes.locator('option[value="FLIGHT"]')).toHaveCount(1);
  await editor.getByLabel("Item name").fill("Cable car segment");
  await resolveLocation(editor, "外滩", { legend: "Transport origin", inputLabel: "Origin location" });
  await resolveLocation(editor, "豫园", { legend: "Transport destination", inputLabel: "Destination location" });
  await modes.selectOption("CABLE_CAR");
  await saveNewItem(editor, "Cable car segment");
  await page.reload();
  const existing = await openItem(page, "Cable car segment");
  await expect(existing.getByLabel("Transport mode")).toHaveValue("CABLE_CAR");
});

test("E2E-014 — explicit location search, candidate confirmation and persistence", async ({ page }) => {
  await createTrip(page, { name: caseName("E2E-014", "location-confirmation") });
  const editor = await openNewItem(page, "attraction");
  await editor.getByLabel("Item name").fill("人民广场散步");
  const location = editor.getByRole("group", { name: "Location" });
  await location.getByLabel("Location name").fill("人民广场");
  await location.getByRole("button", { name: "Search location" }).click();
  const candidates = location.getByRole("radiogroup", { name: "Location candidates" });
  await expect(candidates.getByRole("radio")).toHaveCount(2);
  await expect(candidates).toContainText("上海");
  await expect(candidates).toContainText("重庆");
  await expect(candidates).toContainText("fixture");
  await editor.getByLabel("Description").focus();
  await expect(candidates.getByRole("radio").first()).not.toBeChecked();
  await candidates.locator("label").filter({ hasText: /上海/u }).getByRole("radio").check();
  await location.getByRole("button", { name: "Confirm location" }).click();
  await expect(location.getByText(/Location status: resolved/u)).toBeVisible();
  await saveNewItem(editor, "人民广场散步");
  await page.reload();
  const reloaded = await openItem(page, "人民广场散步");
  await expect(reloaded.getByRole("group", { name: "Location" }).getByText(/Location status: resolved.*上海市黄浦区/u)).toBeVisible();
});

test("E2E-015 — map pick, Marker drag and manual coordinate persistence", async ({ page }) => {
  await createTrip(page, { name: caseName("E2E-015", "coordinate-priority") });
  const editor = await openNewItem(page, "attraction");
  await editor.getByLabel("Item name").fill("外滩附近");
  await saveTextLocation(editor, "外滩附近");
  const coordinates = editor.getByRole("region", { name: "Location coordinate adjustment" });
  await expect(coordinates.getByRole("status")).toContainText("unresolved");
  await coordinates.getByText("Precise keyboard map and marker controls").click();
  await coordinates.getByLabel("Map longitude").fill("121.4900");
  await coordinates.getByLabel("Map latitude").fill("31.2400");
  await coordinates.getByRole("button", { name: "Save map point" }).click();
  await expect(coordinates.getByRole("status")).toContainText("121.49, 31.24");
  await coordinates.getByLabel("Map longitude").fill("121.5000");
  await coordinates.getByLabel("Map latitude").fill("31.2300");
  await coordinates.getByRole("button", { name: "Save marker position" }).click();
  await expect(coordinates.getByRole("status")).toContainText("121.5, 31.23");
  await coordinates.getByLabel("Manual longitude").fill("121.5100");
  await coordinates.getByLabel("Manual latitude").fill("31.2200");
  await coordinates.getByRole("button", { name: "Save manual coordinates" }).click();
  await expect(coordinates.getByRole("status")).toContainText("121.51, 31.22");
  await expect(coordinates.getByRole("status")).toContainText("manually adjusted");
  await saveNewItem(editor, "外滩附近");
  await page.reload();
  const reloaded = await openItem(page, "外滩附近");
  await expect(reloaded.getByRole("region", { name: "Location coordinate adjustment" }).getByRole("status")).toContainText("121.51, 31.22");
});

async function fillBooking(editor: Locator, reference: string, contact: string, phone: string) {
  await editor.getByLabel("Booking reference").fill(reference);
  await editor.getByLabel("Contact name").fill(contact);
  await editor.getByLabel("Contact phone").fill(phone);
}

async function assertItemFields(page: Page) {
  let editor = await openItem(page, "晨间活动");
  await expect(editor.getByLabel("Start time")).toHaveValue("09:00");
  await expect(editor.getByLabel("Duration (minutes)")).toHaveValue("60");
  await editor.getByRole("button", { name: "Cancel" }).first().click();
  editor = await openItem(page, "东方明珠");
  await expect(editor.locator('select:has(option[value="morning"])')).toHaveValue("morning");
  await expect(editor.getByRole("group", { name: "Location" }).getByText(/Location status: resolved/u)).toBeVisible();
  await editor.getByRole("button", { name: "Cancel" }).first().click();
  editor = await openItem(page, "午餐");
  await expect(editor.getByLabel("Restaurant")).toHaveValue("本帮餐厅");
  await expect(editor.getByLabel("Meal")).toHaveValue("lunch");
  await expect(editor.getByLabel("Booking reference")).toHaveValue("DINING-001");
  await editor.getByRole("button", { name: "Cancel" }).first().click();
  editor = await openItem(page, "外滩酒店");
  await expect(editor.getByText("Crosses midnight").getByRole("checkbox")).toBeChecked();
  await expect(editor.getByLabel("Details")).toHaveValue("大床房");
  await editor.getByRole("button", { name: "Cancel" }).first().click();
  editor = await openItem(page, "地铁接驳");
  await expect(editor.getByLabel("Transport mode")).toHaveValue("METRO");
  await expect(editor.getByLabel("Booking reference")).toHaveValue("METRO-001");
  await editor.getByRole("button", { name: "Cancel" }).first().click();
  editor = await openItem(page, "自由安排");
  await expect(editor.getByLabel("Time type")).toHaveValue("unscheduled");
  await editor.getByRole("button", { name: "Cancel" }).first().click();
}

async function dragBefore(page: Page, source: string, target: string) {
  const from = page.getByRole("button", { name: `Drag ${source}` });
  const to = page.getByRole("button", { name: `Drag ${target}` });
  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  if (!fromBox || !toBox) throw new Error(`Unable to drag ${source} before ${target}`);
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + 2, { steps: 12 });
  await page.mouse.up();
}
