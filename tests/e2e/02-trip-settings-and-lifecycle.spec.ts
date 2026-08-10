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

  await page.getByRole("link", { name: "Trip settings" }).click();
  await page.getByRole("button", { name: "Edit trip" }).click();
  const dateForm = page.getByRole("form", { name: "Trip dates" });
  await dateForm.getByLabel("End date").fill("2026-10-05");
  await dateForm.getByRole("button", { name: "Preview date changes" }).click();
  const preview = dateForm.getByRole("region", { name: "Date change preview" });
  await expect(preview).toContainText("5 days after this change");
  await expect(preview).toContainText("2026-10-04");
  await expect(preview).toContainText("2026-10-05");
  await preview.getByRole("button", { name: "Apply date changes" }).click();
  await expect(page.getByRole("status")).toContainText("5 days");
  await page.getByRole("link", { name: "Back to itinerary" }).click();
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Select day" }).getByRole("button")).toHaveCount(5);
  await selectDay(page, 1);
  await expect.poll(() => timelineLabels(page, 1)).toEqual(["Day 1 保留事项"]);
  await selectDay(page, 2);
  await expect.poll(() => timelineLabels(page, 2)).toEqual(["Day 2 保留事项"]);
  await selectDay(page, 3);
  await expect.poll(() => timelineLabels(page, 3)).toEqual([]);

  await page.getByRole("link", { name: "Trip settings" }).click();
  await page.getByRole("button", { name: "Edit trip" }).click();
  const contractionForm = page.getByRole("form", { name: "Trip dates" });
  await contractionForm.getByLabel("End date").fill("2026-10-03");
  await contractionForm.getByRole("button", { name: "Preview date changes" }).click();
  const contraction = contractionForm.getByRole("region", { name: "Date change preview" });
  await expect(contraction).toContainText("Days removed: 2026-10-04, 2026-10-05");
  await contraction.getByRole("button", { name: "Apply date changes" }).click();
  await expect(page.getByRole("status")).toContainText("3 days");
  await page.getByRole("link", { name: "Back to itinerary" }).click();
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Select day" }).getByRole("button")).toHaveCount(3);
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

  await page.getByRole("link", { name: "Trip settings" }).click();
  await page.getByRole("button", { name: "Edit trip" }).click();
  const settings = page.getByRole("form", { name: "Trip details" });
  await settings.getByLabel("Trip name").fill(updatedName);
  await settings.getByLabel("Description").fill("Lifecycle confirmed; mixed description.");
  await settings.getByLabel("Travelers").fill("4");
  await settings.getByLabel("Budget").fill("12000.50");
  await settings.getByLabel("Default currency").selectOption("EUR");
  await settings.getByLabel("Timezone").fill("Asia/Shanghai");
  await settings.getByLabel("Map profile").selectOption("cn_primary");
  await settings.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Trip settings saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: updatedName })).toBeVisible();
  await page.getByRole("button", { name: "Edit trip" }).click();
  const refreshed = page.getByRole("form", { name: "Trip details" });
  await expect(refreshed.getByLabel("Description")).toHaveValue("Lifecycle confirmed; mixed description.");
  await expect(refreshed.getByLabel("Travelers")).toHaveValue("4");
  await expect(refreshed.getByLabel("Budget")).toHaveValue("12000.50");
  await expect(refreshed.getByLabel("Default currency")).toHaveValue("EUR");

  const danger = page.getByRole("region", { name: "Delete trip" });
  await danger.getByRole("button", { name: "Delete trip" }).click();
  await danger.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page).toHaveURL(/\/trips$/u);
  await expect(page.getByRole("list", { name: "Active trips" }).getByText(updatedName)).toHaveCount(0);
  await page.getByRole("tab", { name: "Trash" }).click();
  const recycleBin = page.getByRole("list", { name: "Deleted trips" });
  await expect(recycleBin.getByRole("heading", { name: updatedName })).toBeVisible();
  await recycleBin.getByRole("listitem").filter({ hasText: updatedName }).getByRole("button", { name: "Restore trip" }).click();
  await expect(page.getByRole("status")).toContainText(`“${updatedName}” was restored`);
  await expect(page.getByRole("list", { name: "Active trips" }).getByRole("heading", { name: updatedName })).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: updatedName }).getByRole("link", { name: "Open trip" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}$`, "u"));
  await page.reload();
  await expect(page.getByRole("button", { name: "Edit 生命周期保留事项" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Select day" }).getByRole("button")).toHaveCount(5);
});
