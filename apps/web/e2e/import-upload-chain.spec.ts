import { expect, test } from "@playwright/test";
import { createTripWorkspace } from "./helpers";

test("TC-E02-04 real upload creates an ImportJob consumed by the workspace", async ({ page }) => {
  await createTripWorkspace(page, "真实上传链路验证");
  const workspace = page.getByRole("region", { name: "导入映射工作台" });
  await workspace.getByLabel("上传行程文件").setInputFiles({
    name: "trip.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Day,Target\n1,外滩\n"),
  });
  await expect(workspace.getByRole("status")).toContainText("已生成真实 ImportJob", { timeout: 45_000 });
  await expect(workspace.getByRole("button", { name: "保存映射" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "导入映射工作台" }).getByRole("button", { name: "保存映射" })).toBeVisible();
  await expect(page.getByRole("region", { name: "导入预览工作台" })).not.toContainText("暂无真实导入任务");
});
