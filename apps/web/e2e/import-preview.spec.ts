import { expect, test } from "@playwright/test";
import { createTripWorkspace } from "./helpers";

test("TC-E05 preview E2E filters errors and skips only the confirmed row", async ({ page }) => {
  await createTripWorkspace(page, "E05 预览验证");
  const preview = page.getByRole("region", { name: "导入预览工作台" });
  await expect(preview.getByRole("status")).toContainText("尚未写入正式行程");
  await preview.getByRole("button", { name: /error 1/ }).click();
  await preview.getByRole("button", { name: /确认跳过当前页错误/ }).click();
  await preview.getByRole("button", { name: /skipped 1/ }).click();
  await expect(preview).toContainText("已跳过");
  await expect(preview).not.toContainText("已导入");
});
