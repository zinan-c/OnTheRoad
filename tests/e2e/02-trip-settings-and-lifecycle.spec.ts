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
  await expect(page.getByRole("complementary", { name: "Trip days" }).getByRole("button", { name: /^Day \d+,/u })).toHaveCount(5);
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
  await expect(page.getByRole("complementary", { name: "Trip days" }).getByRole("button", { name: /^Day \d+,/u })).toHaveCount(3);
  await selectDay(page, 1);
  await expect.poll(() => timelineLabels(page, 1)).toEqual(["Day 1 保留事项"]);
  await selectDay(page, 2);
  await expect.poll(() => timelineLabels(page, 2)).toEqual(["Day 2 保留事项"]);
});

test("E2E-008 — Trip update, soft delete and restore lifecycle", async ({ page }) => {
  const originalName = caseName("E2E-008", "待修改旅行");
  const updatedName = `${originalName} 已确认旅行`;
  await page.goto("/trips/new");
  const createForm = page.getByRole("form", { name: "New trip" });
  await createForm.getByLabel("Trip name").fill(originalName);
  await createForm.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/u);
  const tripId = page.url().split("/").at(-1)!;

  await page.goto("/trips?view=draft");
  const draftCard = page.locator(`#trip-card-${tripId}`);
  await expect(draftCard).toBeVisible();
  await draftCard.getByRole("button", { name: "Activate" }).click();
  await expect(page.getByRole("tab", { name: "Active trips" })).toHaveAttribute("aria-selected", "true");
  await page.locator(`#trip-card-${tripId}`).getByRole("link", { name: "Open trip" }).click();
  const retainedItemId = await createSimpleItem(page, "生命周期保留事项", { kind: "attraction" });

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
  await expect(page.locator("#trip-settings-name")).toHaveText(updatedName);
  await page.getByRole("button", { name: "Edit trip" }).click();
  const refreshed = page.getByRole("form", { name: "Trip details" });
  await expect(refreshed.getByLabel("Description")).toHaveValue("Lifecycle confirmed; mixed description.");
  await expect(refreshed.getByLabel("Travelers")).toHaveValue("4");
  await expect(refreshed.getByLabel("Budget")).toHaveValue("12000.50");
  await expect(refreshed.getByLabel("Default currency")).toHaveValue("EUR");

  await page.goto("/trips");
  const activeCard = page.locator(`#trip-card-${tripId}`);
  await activeCard.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("tab", { name: "Archived" })).toHaveAttribute("aria-selected", "true");
  await page.locator(`#trip-card-${tripId}`).getByRole("link", { name: "Open trip" }).click();
  await page.getByRole("link", { name: "Trip settings" }).click();

  const danger = page.getByRole("region", { name: "Delete trip" });
  await danger.getByRole("button", { name: "Delete trip" }).click();
  await danger.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page).toHaveURL(/\/trips$/u);
  await expect(page.locator(`#trip-card-${tripId}`)).toHaveCount(0);
  await page.getByRole("tab", { name: "Trash" }).click();
  const recycleBin = page.getByRole("list", { name: "Trash" });
  const tripCard = recycleBin.locator(`#trip-card-${tripId}`);
  await expect(tripCard.locator("h2")).toHaveText(updatedName);
  await tripCard.getByRole("button", { name: "Restore trip" }).click();
  await expect(page.getByRole("status")).toContainText(`“${updatedName}” was restored`);
  await expect(page.getByRole("tab", { name: "Archived" })).toHaveAttribute("aria-selected", "true");
  const restoredCard = page.locator(`#trip-card-${tripId}`);
  await expect(restoredCard.locator("h2")).toHaveText(updatedName);
  await restoredCard.getByRole("button", { name: "Activate" }).click();
  await page.locator(`#trip-card-${tripId}`).getByRole("link", { name: "Open trip" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}$`, "u"));
  await page.reload();
  await selectDay(page, 1);
  await expect(page.locator(`[data-item-id="${retainedItemId}"]`)).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Trip days" }).getByRole("button", { name: /^Day \d+,/u })).toHaveCount(5);
});
