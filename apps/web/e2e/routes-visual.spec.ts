import { expect, test } from "@playwright/test";
import { createTripWorkspace } from "./helpers";

test("TC-C08-03 route visual/detail E2E renders route modes and selected marker", async ({ page }) => {
  await createTripWorkspace(page, "C08 路线视觉验证");
  await expect(page.getByRole("img", { name: "路线示意图" })).toBeVisible();
  await expect(page.locator("line[data-route-mode]")).toHaveCount(2);
  await page.getByRole("button", { name: "地图点 地点2" }).click();
  await expect(page.getByRole("status").filter({ hasText: "当前选择" })).toContainText("地点2");
});
