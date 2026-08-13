import { expect, test } from "@playwright/test";
import { createTripWorkspace } from "./helpers";

const apiOrigin = process.env.OTR_PLAYWRIGHT_API_ORIGIN ?? "http://127.0.0.1:3101";

test.setTimeout(180_000);

test("TC-E07-03 unresolved location E2E confirms three decisions before formal commit", async ({ page }) => {
  const tripId = await createTripWorkspace(page, "E07 未确认地点");
  const days = await page.request.get(`${apiOrigin}/api/v1/trips/${tripId}/days`).then((response) => response.json()) as Array<{ id: string }>;
  const formalItemCount = await countItems(page, tripId, days[0]?.id ?? "");
  const mapping = page.getByRole("region", { name: "导入映射工作台" });
  await mapping.getByLabel("上传行程文件").setInputFiles({
    name: "e07-unresolved.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Day,Target,Address\n1,候选地点,外滩\n1,地图确认,人民广场\n1,纯文字确认,未知地点\n"),
  });
  await expect(mapping.getByRole("status").filter({ hasText: "已生成真实 ImportJob" })).toBeVisible({ timeout: 45_000 });
  await mapping.getByRole("button", { name: "保存映射" }).click();

  await expect.poll(async () => await latestImportStatus(page, tripId), {
    timeout: 60_000,
    intervals: [250, 500, 1_000],
  }).toBe("confirmation_required");
  const job = await latestImport(page, tripId);
  const started = await page.request.post(`${apiOrigin}/api/v1/imports/${job.id}/geocode`);
  expect(started.ok(), await started.text()).toBe(true);
  await expect.poll(async () => (await page.request.get(`${apiOrigin}/api/v1/imports/${job.id}/geocode`).then((response) => response.json()) as { status: string }).status, {
    timeout: 60_000,
    intervals: [250, 500, 1_000],
  }).toBe("completed_with_warnings");

  let unresolved = await listUnresolved(page, job.id);
  expect(unresolved).toHaveLength(3);
  const byText = new Map(unresolved.map((location) => [location.inputText, location]));
  const candidateDecision = await page.request.post(`${apiOrigin}/api/v1/imports/${job.id}/unresolved-locations/${byText.get("外滩")!.id}/decision`, {
    data: { type: "candidate", candidateToken: byText.get("外滩")!.candidates[0]!.candidateToken },
  });
  expect(candidateDecision.ok(), await candidateDecision.text()).toBe(true);
  const mapDecision = await page.request.post(`${apiOrigin}/api/v1/imports/${job.id}/unresolved-locations/${byText.get("人民广场")!.id}/decision`, {
    data: { type: "map_point", point: { latitude: 31.2304, longitude: 121.4737 }, name: "地图确认" },
  });
  expect(mapDecision.ok(), await mapDecision.text()).toBe(true);
  const textDecision = await page.request.post(`${apiOrigin}/api/v1/imports/${job.id}/unresolved-locations/${byText.get("未知地点")!.id}/decision`, {
    data: { type: "accept_text", name: "未知地点" },
  });
  expect(textDecision.ok(), await textDecision.text()).toBe(true);

  await page.reload();
  await expect.poll(async () => await latestImportStatus(page, tripId), {
    timeout: 30_000,
    intervals: [250, 500, 1_000],
  }).toBe("ready_to_import");
  unresolved = await listUnresolved(page, job.id);
  expect(unresolved).toEqual([]);
  expect(await countItems(page, tripId, days[0]?.id ?? "")).toBe(formalItemCount);
});

async function latestImport(page: Parameters<typeof test>[0]["page"], tripId: string) {
  const response = await page.request.get(`${apiOrigin}/api/v1/trips/${tripId}/imports/latest`);
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as { id: string; status: string };
}

async function latestImportStatus(page: Parameters<typeof test>[0]["page"], tripId: string) {
  return (await latestImport(page, tripId)).status;
}

async function listUnresolved(page: Parameters<typeof test>[0]["page"], jobId: string) {
  const response = await page.request.get(`${apiOrigin}/api/v1/imports/${jobId}/unresolved-locations`);
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as Array<{ id: string; inputText: string; candidates: Array<{ candidateToken: string }> }>;
}

async function countItems(page: Parameters<typeof test>[0]["page"], tripId: string, dayId: string) {
  const response = await page.request.get(`${apiOrigin}/api/v1/trips/${tripId}/days/${dayId}/itinerary-items`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json() as unknown[]).length;
}
