import { expect, test } from "@playwright/test";
import { createTripWorkspace } from "./helpers";

test("TC-D05-03 cost page E2E saves an expense and refreshes totals", async ({ page }) => {
  await createTripWorkspace(page, "D05 费用汇总验证");
  await page.getByTestId("edit-itinerary").click();
  const firstItem = page.getByTestId("itinerary-item").filter({
    has: page.getByRole("heading", { name: "地点1", exact: true }),
  });
  await firstItem.getByTestId("edit-itinerary-item").click();
  const editor = page.getByTestId("item-editor");
  await editor.getByLabel("Amount").fill("80");
  await editor.getByTestId("save-item-button").click();
  await expect(page.getByRole("region", { name: "Expense summary" })).toContainText("80.0000 CNY");
  await expect(page.getByRole("region", { name: "Selected day expense details" })).toContainText("地点1");
});
