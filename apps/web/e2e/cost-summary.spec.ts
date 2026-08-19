import { expect, test } from "@playwright/test";
import { createTripWorkspace } from "./helpers";

test("TC-D05-03 cost page E2E saves an expense and refreshes totals", async ({ page, isMobile }) => {
  await createTripWorkspace(page, "D05 费用汇总验证");
  await page.getByTestId("edit-itinerary").click();
  const firstItem = page.getByTestId("itinerary-item").filter({
    has: page.getByRole("heading", { name: "地点1", exact: true }),
  });
  const editButton = firstItem.getByTestId("edit-itinerary-item");
  if (isMobile) {
    const orderControls = page.getByLabel("地点1 ordering controls");
    const [editBox, orderBox] = await Promise.all([
      editButton.boundingBox(),
      orderControls.boundingBox(),
    ]);
    expect(editBox).not.toBeNull();
    expect(orderBox).not.toBeNull();
    expect(rectanglesOverlap(editBox!, orderBox!)).toBe(false);
  }
  await editButton.click();
  const editor = page.getByTestId("item-editor");
  await editor.getByLabel("Amount").fill("80");
  await editor.getByTestId("save-item-button").click();
  await expect(page.getByRole("region", { name: "Expense summary" })).toContainText("80.0000 CNY");
  await expect(page.getByRole("region", { name: "Selected day expense details" })).toContainText("地点1");
});

function rectanglesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}
