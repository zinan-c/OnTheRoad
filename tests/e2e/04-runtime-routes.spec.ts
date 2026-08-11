import { expect, test } from "@playwright/test";

import {
  caseName,
  createLocatedSequence,
  createTrip,
  openItem,
  openNewItem,
  resolveLocation,
  saveNewItem,
  saveTextLocation,
  selectDay,
  waitForAutosave,
} from "./helpers";

test("E2E-016 — full runtime DirectionsProvider-to-MapLibre happy path", async ({ page }) => {
  const tileRequest = page.waitForResponse((response) =>
    response.ok() && new URL(response.url()).pathname.startsWith("/api/map/tiles/"));
  await createTrip(page, { name: caseName("E2E-016", "runtime-route") });
  await createLocatedSequence(page, [
    { target: "A", query: "外滩" },
    { target: "B", query: "豫园", mode: "WALK" },
  ]);
  const editor = await openNewItem(page, "attraction");
  await editor.getByLabel("Item name").fill("C");
  await resolveLocation(editor, "人民广场");
  await editor.getByLabel("Inbound transport mode").selectOption("METRO");
  const generating = expect(page.getByRole("status").filter({ hasText: "Generating routes" })).toBeVisible();
  await saveNewItem(editor);
  await generating;
  const map = page.getByRole("application", { name: "Route map" });
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute("data-route-count", "2", { timeout: 30_000 });
  await tileRequest;
  await expect(page.getByText("Map data © On The Road fixture", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Route mode legend" })).toContainText("WALK");
  await expect(page.getByRole("list", { name: "Route mode legend" })).toContainText("METRO");

  const timelineB = page.getByRole("list", { name: "Itinerary timeline" }).getByRole("button", { name: "B", exact: true });
  await timelineB.click();
  await expect(timelineB).toHaveAttribute("aria-pressed", "true");
  await map.getByRole("button", { name: /C$/u }).click();
  await expect(page.getByRole("list", { name: "Itinerary timeline" }).getByRole("button", { name: "C", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("list", { name: "Route list" }).getByRole("button").filter({ hasText: "A → B" }).click();
  const details = page.getByRole("complementary", { name: "Route details" });
  await expect(details).toContainText("WALK");
  await expect(details).toContainText("fixture");
  await expect(details).toContainText("Actual route");
  await expect(details).toContainText("→");

  await page.reload();
  await expect(map).toHaveAttribute("data-route-count", "2", { timeout: 30_000 });
  await page.getByRole("list", { name: "Itinerary timeline" }).getByRole("button", { name: "B", exact: true }).click();
  await map.getByRole("button", { name: /C$/u }).click();
  await page.getByRole("list", { name: "Route list" }).getByRole("button").filter({ hasText: "A → B" }).click();
  await expect(page.getByRole("complementary", { name: "Route details" })).toContainText("fixture");
});

test("E2E-017 — cross-day and transport-internal route matrix", async ({ page }) => {
  await createTrip(page, {
    name: caseName("E2E-017", "route-matrix"),
    startDate: "2026-10-01",
    endDate: "2026-10-02",
  });
  const [itemAId] = await createLocatedSequence(page, [
    { target: "A", query: "外滩", day: 1, mode: "WALK" },
    { target: "B", query: "豫园", day: 1, mode: "FLIGHT" },
    { target: "C", query: "人民广场", day: 2, mode: "FERRY" },
  ]);
  let editor = await openNewItem(page, "transport");
  await editor.getByLabel("Item name").fill("D");
  await resolveLocation(editor, "外滩", { legend: "Transport origin", inputLabel: "Origin location" });
  await resolveLocation(editor, "豫园", { legend: "Transport destination", inputLabel: "Destination location" });
  await editor.getByLabel("Transport mode").selectOption("CABLE_CAR");
  await saveNewItem(editor);
  await createLocatedSequence(page, [{ target: "E", query: "外滩", day: 2, mode: "PUBLIC_BUS" }]);
  editor = await openNewItem(page, "attraction");
  await editor.getByLabel("Item name").fill("F");
  await saveTextLocation(editor, "尚未确认的 F");
  await editor.getByLabel("Inbound transport mode").selectOption("WALK");
  await saveNewItem(editor);

  const routeList = page.getByRole("list", { name: "Route list" });
  await expect(routeList.getByRole("button")).toHaveCount(5, { timeout: 30_000 });
  await expect(routeList).toContainText("Transport route");
  await expect(routeList).toContainText("Actual route");
  await selectDay(page, 1);
  await expect(routeList).toContainText("A → B");
  await expect(routeList).not.toContainText("D → D");
  await selectDay(page, 2);
  await expect(routeList).toContainText("B → C");
  await expect(routeList).toContainText("D → D");
  await selectDay(page, 1);
  await page.getByRole("button", { name: "Move B up" }).click();
  await expect(page.getByRole("status").filter({ hasText: "B moved to position 1" })).toBeVisible();
  editor = await openItem(page, itemAId!);
  await editor.getByLabel("Inbound transport mode").selectOption("PUBLIC_BUS");
  await waitForAutosave(editor);
  await editor.getByRole("button", { name: "Cancel" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Generating routes" })).toBeVisible();
  await expect(routeList).toContainText("B → A", { timeout: 30_000 });
  await selectDay(page, 2);
  const gaps = page.getByRole("complementary", { name: "Route gaps" });
  await expect(gaps).toContainText("F", { timeout: 30_000 });
  await expect(gaps).toContainText(/not confirmed|missing/u);
  await page.reload();
  await selectDay(page, 1);
  await expect(page.getByRole("list", { name: "Route list" })).toContainText("B → A", { timeout: 30_000 });
  await selectDay(page, 2);
  await expect(page.getByRole("complementary", { name: "Route gaps" })).toContainText("F");
});
