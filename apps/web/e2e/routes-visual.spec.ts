import { expect, test } from "@playwright/test";
import { createLocatedTripWorkspace } from "./helpers";

test("TC-C08-03 route visual/detail E2E renders route modes and selected marker", async ({ page }) => {
  const tileRequest = page.waitForResponse((response) => response.url().includes("/api/map/tiles/") && response.ok());
  await createLocatedTripWorkspace(page, "C08 路线视觉验证");
  await expect(page.getByRole("application", { name: "真实地图路线" })).toHaveAttribute("data-route-count", "2");
  await expect(tileRequest).resolves.toBeTruthy();
  await page.getByRole("application", { name: "真实地图路线" }).getByRole("button", { name: /C$/u }).click();
  await expect(page.getByRole("status").filter({ hasText: "当前选择" })).toContainText("C");
  await page.getByRole("list", { name: "路线列表" }).getByRole("button").first().click();
  await expect(page.getByRole("complementary", { name: "路线详情" })).toContainText("fixture");
  await expect(page.getByRole("complementary", { name: "路线详情" })).toContainText("真实路线");
});
