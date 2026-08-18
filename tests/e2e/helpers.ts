import { expect, type Locator, type Page } from "@playwright/test";

export const API_ORIGIN = process.env.OTR_PLAYWRIGHT_API_ORIGIN ?? "http://127.0.0.1:3101";

export type TripInput = {
  name: string;
  startDate?: string;
  endDate?: string;
  destinations?: string;
  travelers?: number;
  currency?: string;
};

export function caseName(caseId: string, label: string): string {
  return `${caseId} ${label} ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export async function createTrip(page: Page, input: TripInput): Promise<string> {
  await page.goto("/");
  await page.getByRole("link", { name: "Create a trip" }).click();
  await expect(page.getByRole("form", { name: "New trip" })).toBeVisible();
  await page.getByLabel("Trip name").fill(input.name);
  if (input.startDate) await page.getByLabel("Start date").fill(input.startDate);
  if (input.endDate) await page.getByLabel("End date").fill(input.endDate);
  if (input.destinations) await page.getByLabel("Destinations").fill(input.destinations);
  if (input.travelers !== undefined) await page.getByLabel("Travelers").fill(String(input.travelers));
  if (input.currency) await page.getByLabel("Default currency").selectOption(input.currency);
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/u);
  await expect(page.locator("#trip-title")).toHaveText(input.name);
  return page.url().split("/").at(-1)!;
}

export async function selectDay(page: Page, dayNumber: number): Promise<void> {
  let workspace = page.getByRole("region", { name: "Daily itinerary", exact: true });
  let loaded: Promise<import("@playwright/test").Response> | undefined;
  const railDay = page.getByRole("complementary", { name: "Trip days" })
    .getByRole("button", { name: new RegExp(`^Day ${dayNumber},`, "u") });
  if (await workspace.count() === 0) {
    loaded = page.waitForResponse((response) => response.request().method() === "GET"
      && /\/days\/[0-9a-f-]+\/itinerary-items$/u.test(new URL(response.url()).pathname));
    await railDay.click();
    workspace = page.getByRole("region", { name: "Daily itinerary", exact: true });
  } else if (await railDay.getAttribute("aria-pressed") !== "true") {
    loaded = page.waitForResponse((response) => response.request().method() === "GET"
      && /\/days\/[0-9a-f-]+\/itinerary-items$/u.test(new URL(response.url()).pathname));
    await railDay.click();
  }
  await expect(workspace).toBeVisible();
  const localDay = workspace.getByRole("button", { name: `Day ${dayNumber}`, exact: true });
  if (await localDay.count() > 0 && await localDay.getAttribute("aria-pressed") !== "true") {
    loaded ??= page.waitForResponse((response) => response.request().method() === "GET"
      && /\/days\/[0-9a-f-]+\/itinerary-items$/u.test(new URL(response.url()).pathname));
    await localDay.click();
    await expect(localDay).toHaveAttribute("aria-pressed", "true");
  }
  if (loaded) expect((await loaded).ok()).toBe(true);
}

export async function openNewItem(page: Page, kind: "activity" | "attraction" | "dining" | "accommodation" | "transport" | "other") {
  if (await page.getByRole("button", { name: "Add item", exact: true }).count() === 0) {
    await selectDay(page, 1);
  }
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  const editor = page.getByRole("form", { name: "Add item" });
  await expect(editor).toBeVisible();
  await editor.getByLabel("Item type").selectOption(kind);
  return editor;
}

export async function resolveLocation(
  scope: Locator,
  text: string,
  options: { legend?: string; inputLabel?: string; candidateIndex?: number } = {},
): Promise<void> {
  const inputLabel = options.inputLabel ?? "Location name";
  const controlId = inputLabel.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  const group = scope.getByRole("group", { name: options.legend ?? "Location" });
  await group.getByLabel(inputLabel).fill(text);
  await group.getByRole("button", { name: "Search location" }).click();
  const candidates = group.getByRole("radiogroup", { name: "Location candidates" });
  await expect(candidates).toBeVisible();
  const choice = candidates.locator(`#${controlId}-candidate-${options.candidateIndex ?? 0}`);
  await choice.check();
  await group.getByRole("button", { name: "Confirm location" }).click();
  await expect(group.locator(`#${controlId}-status`)).toContainText("Location status: resolved");
}

export async function saveTextLocation(
  scope: Locator,
  text: string,
  options: { legend?: string; inputLabel?: string } = {},
): Promise<void> {
  const inputLabel = options.inputLabel ?? "Location name";
  const controlId = inputLabel.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  const group = scope.getByRole("group", { name: options.legend ?? "Location" });
  await group.getByLabel(inputLabel).fill(text);
  await group.getByRole("button", { name: "Save text only" }).click();
  await expect(group.locator(`#${controlId}-status`)).toContainText("Location status: unresolved");
}

export async function saveNewItem(editor: Locator): Promise<string> {
  const response = editor.page().waitForResponse((candidate) =>
    candidate.request().method() === "POST"
      && /\/itinerary-items$/u.test(new URL(candidate.url()).pathname));
  await editor.getByRole("button", { name: "Save item" }).click();
  const savedResponse = await response;
  expect(savedResponse.ok()).toBe(true);
  const saved = await savedResponse.json() as { id: string };
  const savedEditor = editor.page().getByRole("form", { name: "Edit item" });
  if (await savedEditor.count() > 0 && await savedEditor.isVisible()) {
    await expect(savedEditor.locator("footer").getByRole("status")).toHaveText("Saved");
    await savedEditor.getByRole("button", { name: "Cancel" }).first().click();
    await expect(editor.page().locator(`#itinerary-item-edit-${saved.id}`)).toBeVisible();
  } else {
    await expect(editor.page().locator(`[data-item-id="${saved.id}"]`)).toBeVisible();
  }
  return saved.id;
}

export async function createSimpleItem(
  page: Page,
  target: string,
  options: {
    kind?: "activity" | "attraction" | "dining" | "accommodation" | "transport" | "other";
    day?: number;
    location?: string;
    mode?: string;
    expense?: { amount: string; currency: string; remark?: string };
  } = {},
): Promise<string> {
  if (options.day) await selectDay(page, options.day);
  const kind = options.kind ?? "attraction";
  const editor = await openNewItem(page, kind);
  await editor.getByLabel("Item name").fill(target);
  if (kind === "dining") await editor.getByLabel("Restaurant").fill(target);
  if (kind === "accommodation") await editor.getByLabel("Property name").fill(target);
  if (options.location && kind !== "transport") await resolveLocation(editor, options.location);
  if (options.mode && kind !== "transport") await editor.getByLabel("Inbound transport mode").selectOption(options.mode);
  if (options.expense) {
    await editor.locator("#item-expense-amount").fill(options.expense.amount);
    await editor.locator("#item-expense-currency").selectOption(options.expense.currency);
    if (options.expense.remark) await editor.locator("#item-expense-remark").fill(options.expense.remark);
  }
  return saveNewItem(editor);
}

export async function openItem(page: Page, itemId: string): Promise<Locator> {
  const legacyEdit = page.locator(`#itinerary-item-edit-${itemId}`);
  if (await legacyEdit.count() > 0) {
    await legacyEdit.click();
  } else {
    let card = page.locator(`[data-item-id="${itemId}"]`);
    if (await card.count() === 0 && await page.getByRole("complementary", { name: "Trip days" }).count() > 0) {
      await selectDay(page, 1);
      card = page.locator(`[data-item-id="${itemId}"]`);
    }
    await expect(card).toBeVisible();
    const itemEdit = card.getByRole("button", { name: /^Item edit /u });
    if (await itemEdit.count() === 0) {
      const workspace = page.getByRole("region", { name: "Daily itinerary", exact: true });
      await workspace.getByRole("button", { name: "Edit", exact: true }).click();
    }
    await card.getByRole("button", { name: /^Item edit /u }).click();
  }
  const editor = page.getByRole("form", { name: "Edit item" });
  await expect(editor).toBeVisible();
  return editor;
}

export async function waitForAutosave(editor: Locator): Promise<void> {
  await expect(editor.locator("footer").getByRole("status")).toHaveText("Unsaved changes");
  await editor.getByRole("button", { name: "Save item" }).click();
  if (await editor.page().getByRole("region", { name: "Daily itinerary", exact: true }).count() > 0) {
    await expect(editor).toHaveCount(0);
  } else {
    await expect(editor.locator("footer").getByRole("status")).toHaveText("Saved");
  }
}

export async function timelineLabels(page: Page, dayNumber: number): Promise<string[]> {
  const workspace = page.getByRole("region", { name: "Daily itinerary", exact: true });
  let workspaceTimeline = workspace
    .getByRole("list", { name: `Day ${dayNumber} itinerary` });
  if (await workspace.count() === 0 && await page.getByRole("complementary", { name: "Trip days" }).count() > 0) {
    await selectDay(page, dayNumber);
    workspaceTimeline = workspace.getByRole("list", { name: `Day ${dayNumber} itinerary` });
  }
  if (await workspaceTimeline.count() > 0) {
    return workspaceTimeline.locator("article[data-item-id] h3").allTextContents();
  }
  const timeline = page.getByRole("list", { name: `Day ${dayNumber} timeline` });
  return timeline.locator(".timelineEditButton strong").allTextContents();
}

export async function createLocatedSequence(
  page: Page,
  entries: ReadonlyArray<{ target: string; query: string; mode?: string; day?: number }>,
): Promise<string[]> {
  const itemIds: string[] = [];
  for (const entry of entries) {
    itemIds.push(await createSimpleItem(page, entry.target, {
      kind: "attraction",
      ...(entry.day ? { day: entry.day } : {}),
      location: entry.query,
      ...(entry.mode ? { mode: entry.mode } : {}),
    }));
  }
  return itemIds;
}
