import { expect, test } from "@playwright/test";
import { createLocatedTripWorkspace } from "./helpers";

test("TC-C09-03 bidirectional focus E2E keeps a single selection", async ({ page }) => {
  await createLocatedTripWorkspace(page, "C09 双向联动验证");
  const timelineItem = page.getByRole("button", { name: "B", exact: true });
  await timelineItem.click();
  await expect(timelineItem).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("application", { name: "真实地图路线" }).getByRole("button", { name: /C$/u }).click();
  await expect(page.getByRole("button", { name: "C", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(timelineItem).toHaveAttribute("aria-pressed", "false");
});
