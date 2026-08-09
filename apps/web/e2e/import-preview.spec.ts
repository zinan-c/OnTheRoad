import { expect, test } from "@playwright/test";
import { createTripWorkspace, uploadImportFixture } from "./helpers";

test.setTimeout(180_000);
test("TC-E05-03 5,000-row preview E2E filters errors and keeps mobile controls usable", async ({ page, isMobile }) => {
  await createTripWorkspace(page, "E05 预览验证");
  const expectedRows = isMobile ? 100 : 5_000;
  await uploadImportFixture(page, expectedRows);
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
  const livePreview = page.getByRole("region", { name: "服务端导入预览" });
  await expect(livePreview.getByRole("button", { name: new RegExp(`全部 ${expectedRows}`) })).toBeVisible({ timeout: 60_000 });
  await expect(livePreview.getByRole("button", { name: /error 1/ })).toBeVisible();
  await page.reload();
  const preview = page.getByRole("region", { name: "导入预览工作台" });
  await expect(preview.getByRole("status")).toContainText("尚未写入正式行程");
  await preview.getByRole("button", { name: /error 1/ }).click();
  const [skipped] = await Promise.all([
    page.waitForResponse((response) =>
      response.request().method() === "POST"
      && response.url().includes("/preview/skip")),
    preview.getByRole("button", { name: /确认跳过当前页错误/ }).click(),
  ]);
  expect(skipped.ok(), await skipped.text()).toBe(true);
  await preview.getByRole("button", { name: /skipped 1/ }).click();
  await expect(preview).toContainText("已跳过");
  await expect(preview).not.toContainText("已导入");
});
