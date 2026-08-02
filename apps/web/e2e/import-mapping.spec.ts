import { expect, test } from "@playwright/test";
import { createTripWorkspace } from "./helpers";

test("TC-E03 mapping E2E saves a valid mapping through the API", async ({ page }) => {
  await createTripWorkspace(page, "E03 映射验证");
  const mapping = page.getByRole("region", { name: "导入映射工作台" });
  await mapping.getByRole("button", { name: "保存映射" }).click();
  await expect(mapping.getByRole("status")).toContainText("映射已保存");
  await page.reload();
  await expect(mapping.getByRole("combobox").first()).toHaveValue("Target");
});
