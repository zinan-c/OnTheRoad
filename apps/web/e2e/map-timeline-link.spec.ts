import { expect, test } from "@playwright/test";
import { createTripWorkspace } from "./helpers";

test("TC-C09 map and timeline keep a single selection", async ({ page }) => {
  await createTripWorkspace(page, "C09 双向联动验证");
  const timelineItem = page.getByRole("button", { name: "地点2", exact: true });
  await timelineItem.click();
  await expect(timelineItem).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "地图点 地点3" }).click();
  await expect(page.getByRole("button", { name: "地点3", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(timelineItem).toHaveAttribute("aria-pressed", "false");
});
