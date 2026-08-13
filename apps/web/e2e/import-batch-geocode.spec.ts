import { expect, test, type Page } from "@playwright/test";
import { createTripWorkspace } from "./helpers";

const apiOrigin = process.env.OTR_PLAYWRIGHT_API_ORIGIN ?? "http://127.0.0.1:3101";

test.setTimeout(180_000);

test("TC-E06-03 staging geocode E2E survives refresh and keeps formal items untouched", async ({ page }) => {
  const tripId = await createTripWorkspace(page, "E06 批量地理编码");
  const mapping = page.getByRole("region", { name: "导入映射工作台" });
  await mapping.getByLabel("上传行程文件").setInputFiles({
    name: "e06-geocode.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Day,Target,Address\n1,外滩行程,外滩\n1,人民广场行程,人民广场\n"),
  });
  await expect(mapping.getByRole("status").filter({ hasText: "已生成真实 ImportJob" })).toBeVisible({ timeout: 45_000 });
  await expect(mapping.getByRole("button", { name: "保存映射" })).toBeVisible();
  await mapping.getByRole("button", { name: "保存映射" }).click();

  await expect.poll(async () => {
    const response = await page.request.get(`${apiOrigin}/api/v1/trips/${tripId}/imports/latest`);
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json() as { status: string }).status;
  }, { timeout: 60_000, intervals: [250, 500, 1_000] }).toBe("confirmation_required");
  const job = await page.request.get(`${apiOrigin}/api/v1/trips/${tripId}/imports/latest`).then((response) => response.json()) as { id: string; status: string };
  const days = await page.request.get(`${apiOrigin}/api/v1/trips/${tripId}/days`).then((response) => response.json()) as Array<{ id: string }>;
  const itemCountBefore = await countItems(page, tripId, days[0]?.id ?? "");

  const started = await page.request.post(`${apiOrigin}/api/v1/imports/${job.id}/geocode`);
  expect(started.ok(), await started.text()).toBe(true);
  await expect.poll(async () => (await page.request.get(`${apiOrigin}/api/v1/imports/${job.id}/geocode`).then((response) => response.json()) as { status: string }).status, {
    timeout: 60_000,
    intervals: [250, 500, 1_000],
  }).toBe("completed_with_warnings");

  await page.reload();
  const batch = await page.request.get(`${apiOrigin}/api/v1/imports/${job.id}/geocode`).then((response) => response.json()) as {
    status: string;
    totalUnits: number;
    resolvedUnits: number;
    ambiguousUnits: number;
    failedUnits: number;
  };
  expect(batch).toMatchObject({
    status: "completed_with_warnings",
    totalUnits: 2,
    resolvedUnits: 1,
    ambiguousUnits: 1,
    failedUnits: 0,
  });
  const unresolved = await page.request.get(`${apiOrigin}/api/v1/imports/${job.id}/unresolved-locations`).then((response) => response.json()) as Array<{ inputText: string; candidates: unknown[] }>;
  expect(unresolved.map(({ inputText }) => inputText)).toEqual(["人民广场", "外滩"]);
  expect(unresolved.find(({ inputText }) => inputText === "外滩")?.candidates).toHaveLength(1);
  expect(unresolved.find(({ inputText }) => inputText === "人民广场")?.candidates).toHaveLength(2);
  expect(await countItems(page, tripId, days[0]?.id ?? "")).toBe(itemCountBefore);
});

async function countItems(page: Page, tripId: string, dayId: string) {
  const response = await page.request.get(`${apiOrigin}/api/v1/trips/${tripId}/days/${dayId}/itinerary-items`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json() as unknown[]).length;
}
