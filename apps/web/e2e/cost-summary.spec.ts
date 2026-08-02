import { expect, test } from "@playwright/test";
import { createTripWorkspace } from "./helpers";

test("TC-D05 cost summary E2E saves an expense and refreshes totals", async ({ page }) => {
  await createTripWorkspace(page, "D05 费用汇总验证");
  await page.evaluate(async () => {
    const response = await fetch("http://127.0.0.1:3001/api/v1/trips/" + location.pathname.split("/").at(-1) + "/expenses", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount: "80", currency: "CNY", categoryCode: "DINING" }) });
    if (!response.ok) throw new Error(await response.text());
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "地点1", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "费用统计" })).toContainText("80.0000 CNY");
  await expect(page.getByRole("region", { name: "费用统计" })).toContainText("DINING");
});
