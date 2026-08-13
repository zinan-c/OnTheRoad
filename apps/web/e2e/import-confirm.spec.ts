import { expect, test, type Page } from "@playwright/test";
import { createTripWorkspace } from "./helpers";

const apiOrigin = process.env.OTR_PLAYWRIGHT_API_ORIGIN ?? "http://127.0.0.1:3101";

test.setTimeout(180_000);

test("TC-E08-03 confirm import E2E commits rows once and survives idempotent replay", async ({ page }) => {
  const tripId = await createTripWorkspace(page, "E08 确认导入");
  const days = await getJson<Array<{ id: string }>>(page, `/api/v1/trips/${tripId}/days`);
  const dayId = days[0]?.id;
  expect(dayId).toBeTruthy();
  const itemCountBefore = await countItems(page, tripId, dayId!);

  const mapping = page.getByRole("region", { name: "导入映射工作台" });
  await mapping.getByLabel("上传行程文件").setInputFiles({
    name: "e08-confirm.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Day,Target,Address,Cost,Currency\n1,确认地点,外滩,20,CNY\n1,确认文字,,10,CNY\n",
    ),
  });
  await expect(mapping.getByRole("status").filter({ hasText: "已生成真实 ImportJob" })).toBeVisible({ timeout: 45_000 });
  await mapping.getByRole("button", { name: "保存映射" }).click();

  await expect.poll(async () => await latestImportStatus(page, tripId), {
    timeout: 60_000,
    intervals: [250, 500, 1_000],
  }).toBe("confirmation_required");
  const job = await latestImport(page, tripId);

  const geocodeStart = await page.request.post(`${apiOrigin}/api/v1/imports/${job.id}/geocode`);
  expect(geocodeStart.ok(), await geocodeStart.text()).toBe(true);
  await expect.poll(async () => {
    return (await getJson<{ status: string }>(page, `/api/v1/imports/${job.id}/geocode`)).status;
  }, {
    timeout: 60_000,
    intervals: [250, 500, 1_000],
  }).toMatch(/^(completed|completed_with_warnings)$/u);

  const unresolved = await getJson<Array<{
    id: string;
    inputText: string;
    candidates: Array<{ candidateToken: string }>;
  }>>(page, `/api/v1/imports/${job.id}/unresolved-locations`);
  const location = unresolved.find((entry) => entry.inputText === "外滩");
  expect(location?.candidates.length).toBe(1);
  const decision = await page.request.post(
    `${apiOrigin}/api/v1/imports/${job.id}/unresolved-locations/${location!.id}/decision`,
    { data: { type: "candidate", candidateToken: location!.candidates[0]!.candidateToken } },
  );
  expect(decision.ok(), await decision.text()).toBe(true);

  await expect.poll(async () => await latestImportStatus(page, tripId), {
    timeout: 30_000,
    intervals: [250, 500, 1_000],
  }).toBe("ready_to_import");

  const firstCommit = await page.request.post(`${apiOrigin}/api/v1/imports/${job.id}/commit`, {
    headers: { "idempotency-key": "e08-confirm-replay" },
  });
  expect(firstCommit.ok(), await firstCommit.text()).toBe(true);
  await expect.poll(async () => {
    return (await getJson<{ status: string }>(page, `/api/v1/imports/${job.id}/commit`)).status;
  }, {
    timeout: 90_000,
    intervals: [250, 500, 1_000, 2_000],
  }).toMatch(/^(completed|completed_with_warnings)$/u);

  const completed = await getJson<{
    status: string;
    committedRows: number;
    importedRows: number;
  }>(page, `/api/v1/imports/${job.id}/commit`);
  expect(completed.committedRows).toBe(2);
  expect(completed.importedRows).toBe(2);
  expect(await countItems(page, tripId, dayId!)).toBe(itemCountBefore + 2);

  const repeatedCommit = await page.request.post(`${apiOrigin}/api/v1/imports/${job.id}/commit`, {
    headers: { "idempotency-key": "e08-confirm-replay" },
  });
  expect(repeatedCommit.ok(), await repeatedCommit.text()).toBe(true);
  await expect.poll(async () => {
    const replayed = await getJson<{ status: string; committedRows: number; importedRows: number }>(
      page,
      `/api/v1/imports/${job.id}/commit`,
    );
    expect(replayed.committedRows).toBe(completed.committedRows);
    expect(replayed.importedRows).toBe(completed.importedRows);
    return replayed.status;
  }, { timeout: 30_000, intervals: [250, 500, 1_000] }).toMatch(/^(completed|completed_with_warnings)$/u);

  const importedExpenses = await Promise.all(
    (await getJson<Array<{ id: string }>>(page, `/api/v1/trips/${tripId}/days/${dayId}/itinerary-items`))
      .slice(itemCountBefore)
      .map(({ id }) => getJson<unknown[]>(page, `/api/v1/trips/${tripId}/itinerary-items/${id}/expenses`)),
  );
  expect(importedExpenses.flat()).toHaveLength(2);
});

async function latestImport(page: Page, tripId: string) {
  return getJson<{ id: string; status: string }>(page, `/api/v1/trips/${tripId}/imports/latest`);
}

async function latestImportStatus(page: Page, tripId: string) {
  return (await latestImport(page, tripId)).status;
}

async function countItems(page: Page, tripId: string, dayId: string) {
  const items = await getJson<unknown[]>(page, `/api/v1/trips/${tripId}/days/${dayId}/itinerary-items`);
  return items.length;
}

async function getJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`${apiOrigin}${path}`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}
