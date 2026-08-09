import { expect, type Locator, type Page } from "@playwright/test";

export const API_ORIGIN = "http://127.0.0.1:3101";

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
  await page.getByRole("link", { name: "创建我的旅行" }).click();
  await expect(page.getByRole("form", { name: "新建旅行" })).toBeVisible();
  await page.getByLabel("旅行名称").fill(input.name);
  if (input.startDate) await page.getByLabel("开始日期").fill(input.startDate);
  if (input.endDate) await page.getByLabel("结束日期").fill(input.endDate);
  if (input.destinations) await page.getByLabel("目的地").fill(input.destinations);
  if (input.travelers !== undefined) await page.getByLabel("同行人数").fill(String(input.travelers));
  if (input.currency) await page.getByLabel("默认币种").selectOption(input.currency);
  await page.getByRole("button", { name: "创建旅行" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/u);
  await expect(page.getByRole("heading", { name: input.name })).toBeVisible();
  return page.url().split("/").at(-1)!;
}

export async function selectDay(page: Page, dayNumber: number): Promise<void> {
  const workspace = page.getByRole("region", { name: "行程编辑工作台" });
  const loaded = page.waitForResponse((response) => response.request().method() === "GET"
    && /\/days\/[0-9a-f-]+\/itinerary-items$/u.test(new URL(response.url()).pathname));
  await workspace.getByRole("button", { name: `Day ${dayNumber}`, exact: true }).click();
  await expect(workspace.getByRole("button", { name: `Day ${dayNumber}`, exact: true })).toHaveAttribute("aria-pressed", "true");
  expect((await loaded).ok()).toBe(true);
}

export async function openNewItem(page: Page, kind: "activity" | "attraction" | "dining" | "accommodation" | "transport" | "other") {
  await page.getByRole("button", { name: `新增 ${kind}`, exact: true }).click();
  const editor = page.getByRole("form", { name: "新增事项" });
  await expect(editor).toBeVisible();
  return editor;
}

export async function resolveLocation(
  scope: Locator,
  text: string,
  options: { legend?: string; inputLabel?: string; candidate?: RegExp } = {},
): Promise<void> {
  const group = scope.getByRole("group", { name: options.legend ?? "地点" });
  await group.getByLabel(options.inputLabel ?? "地点文字").fill(text);
  await group.getByRole("button", { name: "显式搜索地点" }).click();
  const candidates = group.getByRole("radiogroup", { name: "地点候选" });
  await expect(candidates).toBeVisible();
  const choice = options.candidate
    ? candidates.locator("label").filter({ hasText: options.candidate }).getByRole("radio")
    : candidates.getByRole("radio").first();
  await choice.check();
  await group.getByRole("button", { name: "确认候选地点" }).click();
  await expect(group.getByText(/地点状态：resolved/u)).toBeVisible();
}

export async function saveTextLocation(
  scope: Locator,
  text: string,
  options: { legend?: string; inputLabel?: string } = {},
): Promise<void> {
  const group = scope.getByRole("group", { name: options.legend ?? "地点" });
  await group.getByLabel(options.inputLabel ?? "地点文字").fill(text);
  await group.getByRole("button", { name: "暂存文字" }).click();
  await expect(group.getByText(/地点状态：unresolved/u)).toBeVisible();
}

export async function saveNewItem(editor: Locator, target: string): Promise<void> {
  const response = editor.page().waitForResponse((candidate) =>
    candidate.request().method() === "POST"
      && /\/itinerary-items$/u.test(new URL(candidate.url()).pathname));
  await editor.getByRole("button", { name: "保存事项" }).click();
  expect((await response).ok()).toBe(true);
  const savedEditor = editor.page().getByRole("form", { name: "编辑事项" });
  await expect(savedEditor.locator("footer").getByRole("status")).toHaveText("已保存");
  await savedEditor.getByRole("button", { name: "关闭" }).click();
  await expect(editor.page().getByRole("button", { name: `编辑 ${target}` })).toBeVisible();
}

export async function createSimpleItem(
  page: Page,
  target: string,
  options: {
    kind?: "activity" | "attraction" | "dining" | "accommodation" | "transport" | "other";
    day?: number;
    location?: string;
    mode?: string;
  } = {},
): Promise<void> {
  if (options.day) await selectDay(page, options.day);
  const kind = options.kind ?? "attraction";
  const editor = await openNewItem(page, kind);
  await editor.getByLabel("事项名称").fill(target);
  if (kind === "dining") await editor.getByLabel("餐厅").fill(target);
  if (kind === "accommodation") await editor.getByLabel("住宿名称").fill(target);
  if (options.location && kind !== "transport") await resolveLocation(editor, options.location);
  if (options.mode && kind !== "transport") await editor.getByLabel("入站交通方式").selectOption(options.mode);
  await saveNewItem(editor, target);
}

export async function openItem(page: Page, target: string): Promise<Locator> {
  await page.getByRole("button", { name: `编辑 ${target}` }).click();
  const editor = page.getByRole("form", { name: "编辑事项" });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("事项名称")).toHaveValue(target);
  return editor;
}

export async function waitForAutosave(editor: Locator): Promise<void> {
  await expect(editor.locator("footer").getByRole("status")).toHaveText("正在保存…");
  await expect(editor.locator("footer").getByRole("status")).toHaveText("已保存");
}

export async function timelineLabels(page: Page, dayNumber: number): Promise<string[]> {
  const timeline = page.getByRole("list", { name: `Day ${dayNumber} 时间线` });
  return timeline.locator(".timelineEditButton strong").allTextContents();
}

export async function createLocatedSequence(
  page: Page,
  entries: ReadonlyArray<{ target: string; query: string; mode?: string; day?: number }>,
): Promise<void> {
  for (const entry of entries) {
    await createSimpleItem(page, entry.target, {
      kind: "attraction",
      ...(entry.day ? { day: entry.day } : {}),
      location: entry.query,
      ...(entry.mode ? { mode: entry.mode } : {}),
    });
  }
}
