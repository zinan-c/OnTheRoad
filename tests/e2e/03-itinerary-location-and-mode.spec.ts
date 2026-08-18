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

test("E2E-009 — Complete Itinerary Item type and field matrix", async ({ page }) => {
  await createTrip(page, { name: caseName("E2E-009", "item-matrix") });
  const itemIds: Record<string, string> = {};

  let editor = await openNewItem(page, "activity");
  await editor.getByLabel("Item name").fill("晨间活动");
  await editor.getByLabel("Description").fill("城市热身活动");
  await editor.getByLabel("Time type").selectOption("clock");
  await editor.getByLabel("Start time").fill("09:00");
  await editor.getByLabel("Duration (minutes)").fill("60");
  await editor.getByLabel("Notes").fill("带水");
  itemIds.activity = await saveNewItem(editor);

  editor = await openNewItem(page, "attraction");
  await editor.getByLabel("Item name").fill("东方明珠");
  await editor.getByLabel("Time type").selectOption("period");
  await editor.locator('select:has(option[value="morning"])').selectOption("morning");
  await resolveLocation(editor, "人民广场", { candidateIndex: 0 });
  itemIds.attraction = await saveNewItem(editor);

  editor = await openNewItem(page, "dining");
  await editor.getByLabel("Item name").fill("午餐");
  await editor.getByLabel("Time type").selectOption("range");
  await editor.getByLabel("Start time").fill("12:00");
  await editor.getByLabel("End time").fill("13:15");
  await editor.getByLabel("Restaurant").fill("本帮餐厅");
  await editor.getByLabel("Meal").selectOption("lunch");
  await fillBooking(editor, "DINING-001", "王女士", "13800000001");
  itemIds.dining = await saveNewItem(editor);

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
  itemIds.accommodation = await saveNewItem(editor);

  editor = await openNewItem(page, "transport");
  await editor.getByLabel("Item name").fill("地铁接驳");
  await editor.getByLabel("Time type").selectOption("range");
  await editor.getByLabel("Start time").fill("14:00");
  await editor.getByLabel("End time").fill("15:00");
  await resolveLocation(editor, "外滩", { legend: "Transport origin", inputLabel: "Origin location" });
  await resolveLocation(editor, "豫园", { legend: "Transport destination", inputLabel: "Destination location" });
  await editor.getByLabel("Transport mode").selectOption("METRO");
  await fillBooking(editor, "METRO-001", "李先生", "13800000002");
  itemIds.transport = await saveNewItem(editor);

  editor = await openNewItem(page, "other");
  await editor.getByLabel("Item name").fill("自由安排");
  await editor.getByLabel("Time type").selectOption("unscheduled");
  itemIds.other = await saveNewItem(editor);

  expect(await timelineLabels(page, 1)).toEqual(["晨间活动", "东方明珠", "午餐", "外滩酒店", "地铁接驳", "自由安排"]);
  await assertItemFields(page, itemIds);
  await page.reload();
  await expect.poll(() => timelineLabels(page, 1)).toEqual(["晨间活动", "东方明珠", "午餐", "外滩酒店", "地铁接驳", "自由安排"]);
  await assertItemFields(page, itemIds);
});

test("E2E-010 — Item edit, autosave and reload", async ({ page }) => {
  await createTrip(page, { name: caseName("E2E-010", "autosave") });
  const itemId = await createSimpleItem(page, "待编辑景点", { kind: "attraction" });
  const workspaceMode = await page.getByRole("region", { name: "Daily itinerary", exact: true }).count() > 0;
  let editor = await openItem(page, itemId);
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
    await editor.locator("#item-expense-currency").selectOption("CNY");
  await editor.getByRole("group", { name: "Expense" }).getByLabel("Expense remark").fill("Sunrise tickets");
  await editor.getByLabel("Notes").fill("最终备注");
  await waitForAutosave(editor);

  if (workspaceMode) editor = await openItem(page, itemId);

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
  if (workspaceMode) {
    await editor.getByRole("button", { name: "Save item" }).click();
    await expect(editor).toHaveCount(0);
  } else {
    await expect(editor.locator("footer").getByRole("status")).toHaveText("Saved");
  }
  await page.reload();
  const reloaded = await openItem(page, itemId);
  await expect(reloaded.getByLabel("Description")).toHaveValue("最终描述");
  await expect(reloaded.getByLabel("Start time")).toHaveValue("06:00");
  await expect(reloaded.getByLabel("End time")).toHaveValue("07:15");
  await expect(reloaded.getByLabel("Duration (minutes)")).toHaveValue("75");
  await expect(reloaded.getByLabel("Notes")).toHaveValue("最终备注");
  await expect(reloaded.getByRole("group", { name: "Expense" }).getByLabel("Amount")).toHaveValue("88.5");
  await expect(reloaded.locator("#location-name-status")).toContainText("Location status: resolved");
});

test("E2E-011 — Copy, edit copied Item and soft delete", async ({ page }) => {
  await createTrip(page, { name: caseName("E2E-011", "copy-delete") });
  const breakfastId = await createSimpleItem(page, "早餐", { kind: "dining", day: 1 });
  const workspaceMode = await page.getByRole("region", { name: "Daily itinerary", exact: true }).count() > 0;
  if (workspaceMode) await page.getByRole("region", { name: "Daily itinerary", exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
  const copyResponse = page.waitForResponse((response) => response.request().method() === "POST"
    && response.url().endsWith(`/itinerary-items/${breakfastId}/copy`));
  await page.locator(`#itinerary-item-copy-${breakfastId}`).selectOption({ label: "Day 2" });
  const copiedItem = await (await copyResponse).json() as { id: string };
  await selectDay(page, 2);
  if (workspaceMode) {
    await expect(page.locator(`[data-item-id="${copiedItem.id}"]`)).toBeVisible();
  } else {
    await expect(page.locator(`#itinerary-item-edit-${copiedItem.id}`)).toBeVisible();
  }
  let editor = await openItem(page, copiedItem.id);
  await editor.getByLabel("Item name").fill("早餐（复制后修改）");
  await editor.getByLabel("Notes").fill("副本已修改");
  await waitForAutosave(editor);

  await selectDay(page, 1);
  if (workspaceMode) {
    await page.getByRole("region", { name: "Daily itinerary", exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
    await page.locator(`#itinerary-item-delete-${breakfastId}`).click();
    await page.getByRole("dialog", { name: "Delete item?" }).getByRole("button", { name: "Confirm delete" }).click();
    await expect(page.locator(`[data-item-id="${breakfastId}"]`)).toHaveCount(0);
  } else {
    page.once("dialog", (dialog) => void dialog.accept());
    await page.locator(`#itinerary-item-delete-${breakfastId}`).click();
    await expect(page.locator(`#itinerary-item-edit-${breakfastId}`)).toHaveCount(0);
  }
  await page.reload();
  await selectDay(page, 1);
  await expect.poll(() => timelineLabels(page, 1)).toEqual([]);
  await selectDay(page, 2);
  await expect.poll(() => timelineLabels(page, 2)).toEqual(["早餐（复制后修改）"]);
  editor = await openItem(page, copiedItem.id);
  await expect(editor.getByLabel("Notes")).toHaveValue("副本已修改");
});

test("E2E-012 — Same-day reorder across mouse, keyboard and touch", async ({ page, browser }) => {
  const tripId = await createTrip(page, { name: caseName("E2E-012", "reorder") });
  for (const target of ["A", "B", "C", "D"]) await createSimpleItem(page, target, { kind: "attraction" });
  const workspaceMode = await page.getByRole("region", { name: "Daily itinerary", exact: true }).count() > 0;
  if (workspaceMode) await page.getByRole("region", { name: "Daily itinerary", exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
  await dragBefore(page, "B", "A");
  await dragBefore(page, "D", "C");
  await expect.poll(() => timelineLabels(page, 1)).toEqual(["B", "A", "D", "C"]);
  if (workspaceMode) {
    const savedOrder = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith("/itinerary-items/reorder"));
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect((await savedOrder).ok()).toBe(true);
  }
  await page.reload();
  await expect.poll(() => timelineLabels(page, 1)).toEqual(["B", "A", "D", "C"]);
  if (workspaceMode) await page.getByRole("region", { name: "Daily itinerary", exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
  const keyboardReorder = workspaceMode ? undefined : page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/itinerary-items/reorder"));
  await page.getByRole("button", { name: "Move D up" }).click();
  await expect(page.getByRole("status").filter({ hasText: "D moved to position 2" })).toBeVisible();
  if (workspaceMode) {
    const savedKeyboardOrder = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith("/itinerary-items/reorder"));
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect((await savedKeyboardOrder).ok()).toBe(true);
  } else {
    expect((await keyboardReorder!).ok()).toBe(true);
  }
  await expect.poll(() => timelineLabels(page, 1)).toEqual(["B", "D", "A", "C"]);

  const mobileContext = await browser.newContext({ ...devices["Pixel 7"] });
  const mobile = await mobileContext.newPage();
  await mobile.goto(`/trips/${tripId}`);
  await mobile.getByRole("button", { name: "Sign in again" }).click();
  if (workspaceMode) {
    await selectDay(mobile, 1);
    await mobile.getByRole("region", { name: "Daily itinerary", exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
  } else {
    await expect(mobile.getByRole("button", { name: "Edit B" })).toBeVisible();
  }
  const touchReorder = workspaceMode ? undefined : mobile.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/itinerary-items/reorder"));
  await mobile.getByRole("button", { name: "Move B down" }).click();
  await expect(mobile.getByRole("status").filter({ hasText: "B moved to position 2" })).toBeVisible();
  if (workspaceMode) {
    const savedTouchOrder = mobile.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith("/itinerary-items/reorder"));
    await mobile.getByRole("button", { name: "Save", exact: true }).click();
    expect((await savedTouchOrder).ok()).toBe(true);
  } else {
    expect((await touchReorder!).ok()).toBe(true);
  }
  await mobile.reload();
  if (workspaceMode) await selectDay(mobile, 1);
  await expect.poll(() => timelineLabels(mobile, 1)).toEqual(["D", "B", "A", "C"]);
  await mobileContext.close();
});

test("E2E-013 — Custom transport mode lifecycle", async ({ page }) => {
  const mode = {
    code: "CABLE_SHUTTLE_CUSTOM",
    label: "Cable-car shuttle",
    icon: "cable-car",
    color: "#123456",
    lineStyle: "dotted",
  } as const;
  await createTrip(page, { name: caseName("E2E-013", "custom-mode") });

  await page.getByRole("link", { name: "Trip settings" }).click();
  const manager = page.getByRole("region", { name: "Transport mode management" });
  await expect(manager).toBeVisible();
  const form = manager.getByRole("form", { name: "Add custom transport mode" });
  await form.getByLabel("Transport mode code").fill(mode.code);
  await form.getByLabel("Transport mode name").fill(mode.label);
  await form.getByLabel("Transport mode icon").fill(mode.icon);
  await form.getByLabel("Transport mode color").fill(mode.color);
  await form.getByLabel("Transport mode line style").selectOption(mode.lineStyle);
  const createdMode = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/transport-modes"));
  await form.getByRole("button", { name: "Add transport mode" }).click();
  expect((await createdMode).status()).toBe(201);
  const savedMode = manager.locator(`[data-mode-code="${mode.code}"]`);
  await expect(savedMode).toHaveAttribute("data-enabled", "true");
  await expect(savedMode).toHaveAttribute("data-mode-label", mode.label);
  await expect(savedMode).toHaveAttribute("data-mode-icon", mode.icon);
  await expect(savedMode).toHaveAttribute("data-mode-color", mode.color);
  await expect(savedMode).toHaveAttribute("data-mode-line-style", mode.lineStyle);

  await page.getByRole("link", { name: "Back to itinerary" }).click();
  await selectDay(page, 1);
  const editor = await openNewItem(page, "transport");
  const modes = editor.getByLabel("Transport mode");
  await expect(modes.locator(`option[value="${mode.code}"]`)).toHaveText(`${mode.label} (${mode.code})`);
  await editor.getByLabel("Item name").fill("Cable shuttle segment");
  await resolveLocation(editor, "外滩", { legend: "Transport origin", inputLabel: "Origin location" });
  await resolveLocation(editor, "豫园", { legend: "Transport destination", inputLabel: "Destination location" });
  await modes.selectOption(mode.code);
  const itemId = await saveNewItem(editor);

  await page.reload();
  await selectDay(page, 1);
  const timelineMode = page.locator(`[data-transport-mode-code="${mode.code}"]`).first();
  await expect(timelineMode).toHaveAttribute("data-transport-mode-label", mode.label);
  await expect(timelineMode).toHaveAttribute("data-transport-mode-icon", mode.icon);
  await expect(timelineMode).toHaveAttribute("data-transport-mode-color", mode.color);
  await expect(timelineMode).toHaveAttribute("data-transport-mode-line-style", mode.lineStyle);
  const mapMode = page.getByRole("list", { name: "Route mode legend" }).locator(`[data-mode-code="${mode.code}"]`);
  await expect(mapMode).toBeVisible({ timeout: 30_000 });
  await expect(mapMode).toHaveAttribute("data-mode-label", mode.label);
  await expect(mapMode).toHaveAttribute("data-mode-icon", mode.icon);
  await expect(mapMode).toHaveAttribute("data-mode-color", mode.color);
  await expect(mapMode).toHaveAttribute("data-line-style", mode.lineStyle);

  await page.locator(`[data-item-id="${itemId}"]`).click();
  const details = page.getByRole("dialog", { name: "Item details" });
  const detailMode = details.locator('dd[data-transport-mode-code="CABLE_SHUTTLE_CUSTOM"]');
  await expect(detailMode).toContainText(`${mode.label} (${mode.code})`);
  await expect(detailMode).toHaveAttribute("data-transport-mode-icon", mode.icon);
  await expect(detailMode).toHaveAttribute("data-transport-mode-color", mode.color);
  await expect(detailMode).toHaveAttribute("data-transport-mode-line-style", mode.lineStyle);
  await details.getByRole("button", { name: "Close" }).click();

  await page.getByRole("link", { name: "Trip settings" }).click();
  const refreshedManager = page.getByRole("region", { name: "Transport mode management" });
  const deactivate = refreshedManager.locator(`[data-mode-code="${mode.code}"]`).getByRole("button", { name: `Deactivate ${mode.label}` });
  await deactivate.click();
  const deactivated = refreshedManager.locator(`[data-mode-code="${mode.code}"]`);
  await expect(deactivated).toHaveAttribute("data-enabled", "false");
  await expect(deactivated).toContainText("已停用");

  await page.getByRole("link", { name: "Back to itinerary" }).click();
  await selectDay(page, 1);
  await page.locator(`[data-item-id="${itemId}"]`).click();
  const oldDetails = page.getByRole("dialog", { name: "Item details" });
  await expect(oldDetails.locator('dd[data-transport-mode-code="CABLE_SHUTTLE_CUSTOM"]')).toContainText("已停用");
  await oldDetails.getByRole("button", { name: "Close" }).click();
  const newEditor = await openNewItem(page, "transport");
  await expect(newEditor.getByLabel("Transport mode").locator(`option[value="${mode.code}"]`)).toHaveCount(0);
  await newEditor.getByTestId("item-editor-close").click();
});

test("E2E-014 — Explicit location search, candidate confirmation and persistence", async ({ page }) => {
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
  await candidates.locator("#location-name-candidate-0").check();
  await location.getByRole("button", { name: "Confirm location" }).click();
  await expect(location.locator("#location-name-status")).toContainText("Location status: resolved");
  const itemId = await saveNewItem(editor);
  await page.reload();
  const reloaded = await openItem(page, itemId);
  await expect(reloaded.locator("#location-name-status")).toContainText("上海市黄浦区");
});

test("E2E-015 — Map pick, Marker drag and manual coordinate persistence", async ({ page }) => {
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
  const itemId = await saveNewItem(editor);
  await page.reload();
  const reloaded = await openItem(page, itemId);
  await expect(reloaded.getByRole("region", { name: "Location coordinate adjustment" }).getByRole("status")).toContainText("121.51, 31.22");
});

async function fillBooking(editor: Locator, reference: string, contact: string, phone: string) {
  await editor.getByLabel("Booking reference").fill(reference);
  await editor.getByLabel("Contact name").fill(contact);
  await editor.getByLabel("Contact phone").fill(phone);
}

async function assertItemFields(page: Page, itemIds: Record<string, string>) {
  let editor = await openItem(page, itemIds.activity!);
  await expect(editor.getByLabel("Start time")).toHaveValue("09:00");
  await expect(editor.getByLabel("Duration (minutes)")).toHaveValue("60");
  await editor.getByRole("button", { name: "Cancel" }).first().click();
  editor = await openItem(page, itemIds.attraction!);
  await expect(editor.locator('select:has(option[value="morning"])')).toHaveValue("morning");
  await expect(editor.locator("#location-name-status")).toContainText("Location status: resolved");
  await editor.getByRole("button", { name: "Cancel" }).first().click();
  editor = await openItem(page, itemIds.dining!);
  await expect(editor.getByLabel("Restaurant")).toHaveValue("本帮餐厅");
  await expect(editor.getByLabel("Meal")).toHaveValue("lunch");
  await expect(editor.getByLabel("Booking reference")).toHaveValue("DINING-001");
  await editor.getByRole("button", { name: "Cancel" }).first().click();
  editor = await openItem(page, itemIds.accommodation!);
  await expect(editor.getByText("Crosses midnight").getByRole("checkbox")).toBeChecked();
  await expect(editor.getByLabel("Details")).toHaveValue("大床房");
  await editor.getByRole("button", { name: "Cancel" }).first().click();
  editor = await openItem(page, itemIds.transport!);
  await expect(editor.getByLabel("Transport mode")).toHaveValue("METRO");
  await expect(editor.getByLabel("Booking reference")).toHaveValue("METRO-001");
  await editor.getByRole("button", { name: "Cancel" }).first().click();
  editor = await openItem(page, itemIds.other!);
  await expect(editor.getByLabel("Time type")).toHaveValue("unscheduled");
  await editor.getByRole("button", { name: "Cancel" }).first().click();
}

async function dragBefore(page: Page, source: string, target: string) {
  const from = page.getByRole("button", { name: `Drag ${source}` });
  const to = page.getByRole("button", { name: `Drag ${target}` });
  await from.dragTo(to);
}
