import { expect, test } from "@playwright/test";
import { createTripWorkspace } from "./helpers";

test("TC-D05-03 cost page E2E saves an expense and refreshes totals", async ({ page }) => {
  await createTripWorkspace(page, "D05 费用汇总验证");
  await page.getByLabel("金额").fill("80");
  await page.getByRole("button", { name: "添加费用" }).click();
  await expect(page.getByRole("region", { name: "费用统计" })).toContainText("80.0000 CNY");
  await expect(page.getByRole("region", { name: "费用统计" })).toContainText("DINING");
});
