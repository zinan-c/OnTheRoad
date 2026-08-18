import { expect, test, type Locator } from "@playwright/test";

import { caseName, createLocatedSequence, createTrip, openItem, selectDay } from "./helpers";

test("E2E-022 — Global/Day map scope and stable MapLibre sizing", async ({ page }) => {
  await createTrip(page, {
    name: caseName("E2E-022", "map-scope-sizing"),
    startDate: "2026-10-01",
    endDate: "2026-10-02",
  });
  const [dayOneItemId, dayTwoItemId] = await createLocatedSequence(page, [
    { target: "Day one mapped stop", query: "外滩", day: 1, mode: "WALK" },
    { target: "Day two mapped stop", query: "人民广场", day: 2, mode: "METRO" },
  ]);

  await page.reload();
  const routeMap = page.locator("#route-map-canvas");
  const globalScope = page.locator("#map-scope-global");
  await expect(globalScope).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Global map", exact: true })).toBeVisible();
  await expect(routeMap).toHaveAttribute("data-marker-count", "2", { timeout: 30_000 });
  await expect(routeMap.locator(`[data-item-id="${dayOneItemId}"]`)).toBeVisible();
  await expect(routeMap.locator(`[data-item-id="${dayTwoItemId}"]`)).toBeVisible();
  await expectStableMapSize(routeMap, 320);

  await selectDay(page, 1);
  await expect(page.getByRole("heading", { name: "Day 1 route" })).toBeVisible();
  await expect(routeMap).toHaveAttribute("data-marker-count", "1");
  await expect(routeMap.locator(`[data-item-id="${dayOneItemId}"]`)).toBeVisible();
  await expect(routeMap.locator(`[data-item-id="${dayTwoItemId}"]`)).toHaveCount(0);

  await selectDay(page, 2);
  await expect(page.getByRole("heading", { name: "Day 2 route" })).toBeVisible();
  await expect(routeMap).toHaveAttribute("data-marker-count", "1");
  await expect(routeMap.locator(`[data-item-id="${dayOneItemId}"]`)).toHaveCount(0);
  await expect(routeMap.locator(`[data-item-id="${dayTwoItemId}"]`)).toBeVisible();

  await globalScope.click();
  await expect(globalScope).toHaveAttribute("aria-pressed", "true");
  await expect(routeMap).toHaveAttribute("data-marker-count", "2");
  await expect(routeMap.locator(`[data-item-id="${dayOneItemId}"]`)).toBeVisible();
  await expect(routeMap.locator(`[data-item-id="${dayTwoItemId}"]`)).toBeVisible();

  await selectDay(page, 1);
  const editor = await openItem(page, dayOneItemId!);
  const coordinateMap = editor.locator("#location-coordinate-map");
  await expect(coordinateMap).toBeVisible();
  await expect(coordinateMap.locator(".maplibregl-canvas")).toBeVisible();
  await expect(coordinateMap.locator(".maplibregl-ctrl-attrib")).toContainText("Map data © On The Road fixture");
  await expectStableMapSize(coordinateMap, 256);
});

async function expectStableMapSize(map: Locator, expectedHeight: number): Promise<void> {
  const first = await map.boundingBox();
  expect(first).not.toBeNull();
  expect(first!.height).toBe(expectedHeight);
  const canvas = await map.locator("canvas").boundingBox();
  expect(canvas).not.toBeNull();
  expect(canvas!.height).toBeLessThanOrEqual(first!.height);
  await map.page().waitForTimeout(750);
  const settled = await map.boundingBox();
  expect(settled).not.toBeNull();
  expect(settled!.height).toBe(first!.height);
}
