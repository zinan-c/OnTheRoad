import { expect, test } from "@playwright/test";
import { createTripWorkspace, uploadImportFixture } from "./helpers";

test("TC-E03-03 editable mapping E2E saves a valid mapping through the API", async ({ page }) => {
  await createTripWorkspace(page, "E03 映射验证");
  await uploadImportFixture(page);
  const mapping = page.getByRole("region", { name: "导入映射工作台" });
  const [saved] = await Promise.all([
    page.waitForResponse((response) =>
      response.request().method() === "PUT"
      && response.url().includes("/mapping")),
    mapping.getByRole("button", { name: "保存映射" }).click(),
  ]);
  expect(saved.ok(), await saved.text()).toBe(true);
  await expect(
    mapping.getByRole("status").filter({ hasText: "映射已保存" }),
  ).toBeVisible();
  await page.reload();
  await expect(mapping.getByRole("combobox").first()).toHaveValue("Target");
});
