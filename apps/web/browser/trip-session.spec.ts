import { expect, test } from "@playwright/test";

test("TC-B04-03 creates a Trip and Item through the UI and restores its session", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("service-readiness")).toHaveAttribute("data-status", "ready");
  await page.getByTestId("create-trip-link").click();

  await expect(page.getByTestId("trip-create-form")).toBeVisible();
  await page.getByTestId("trip-name-input").fill("Playwright 东海之旅");
  await expect(page.getByTestId("trip-duration-hint")).toBeVisible();
  await page.getByTestId("create-trip-submit").click();

  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/u);
  await expect(page.getByTestId("trip-title")).toHaveText("Playwright 东海之旅");
  await page.getByRole("button", { name: /^Day 1,/u }).click();
  await page.getByTestId("add-itinerary-item").click();
  const editor = page.getByTestId("item-editor");
  await editor.getByTestId("item-name-input").fill("外滩夜景");
  await editor.getByTestId("location-text-input").fill("外滩");
  await editor.getByTestId("location-search-button").click();
  await editor.getByRole("radio").first().check();
  await editor.getByTestId("location-confirm-button").click();
  await expect(editor.getByTestId("location-status")).toHaveAttribute("data-status", "resolved");
  await editor.getByTestId("save-item-button").click();
  await expect(page.getByTestId("itinerary-item").filter({ hasText: "外滩夜景" })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("trip-title")).toHaveText("Playwright 东海之旅");
  await expect(page.getByTestId("all-days-itinerary-hint")).toBeVisible();
  await page.getByRole("button", { name: /^Day 1,/u }).click();
  await expect(page.getByTestId("itinerary-item").filter({ hasText: "外滩夜景" })).toBeVisible();

  await page.getByTestId("sign-out").click();
  await expect(page.getByTestId("session-ended")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("session-ended")).toBeVisible();
  await page.getByTestId("sign-in-again").click();
  await expect(page.getByTestId("trip-title")).toHaveText("Playwright 东海之旅");
});

test("REVIEW-P1-04 keeps the core creation path usable at the project viewport", async ({
  page,
}, testInfo) => {
  await page.goto("/trips/new");
  await expect(page.getByTestId("trip-create-form")).toBeVisible();
  const viewport = page.viewportSize();
  if (testInfo.project.name === "mobile-chromium") {
    expect(viewport?.width).toBeLessThanOrEqual(420);
    await expect(page.getByTestId("trip-name-input")).toBeInViewport();
    const submit = page.getByTestId("create-trip-submit");
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
  }
});
