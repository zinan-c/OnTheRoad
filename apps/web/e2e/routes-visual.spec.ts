import { expect, test } from "@playwright/test";
import { createLocatedTripWorkspace } from "./helpers";

test("TC-C08-03 route visual/detail E2E renders route modes and selected marker", async ({ page }) => {
  const tileRequest = page.waitForResponse((response) => response.url().includes("/api/map/tiles/") && response.ok());
  await createLocatedTripWorkspace(page, "C08 路线视觉验证");
  await expect(page.getByRole("application", { name: "Route map" })).toHaveAttribute("data-route-count", "2");
  await expect(tileRequest).resolves.toBeTruthy();
  await page.getByRole("application", { name: "Route map" }).getByRole("button", { name: /C$/u }).click();
  await expect(page.getByRole("status").filter({ hasText: "Selected:" })).toContainText("C");
  await page.getByRole("list", { name: "Route list" }).getByRole("button").first().click();
  await expect(page.getByRole("complementary", { name: "Route details" })).toContainText("fixture");
  await expect(page.getByRole("complementary", { name: "Route details" })).toContainText("Actual route");
});
