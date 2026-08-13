import { expect, test, type Page } from "@playwright/test";
import { createTripWorkspace } from "./helpers";

const apiOrigin = process.env.OTR_PLAYWRIGHT_API_ORIGIN ?? "http://127.0.0.1:3101";
const readyMediaUrl = "https://www.gstatic.com/webp/gallery/1.webp";
const failedMediaUrl = "https://images.example.test/does-not-resolve.png";

test.setTimeout(240_000);

test("TC-E09-03 media lifecycle E2E aggregates ready/failed tasks and resumes a cancelled import", async ({ page }) => {
  const tripId = await createTripWorkspace(page, "E09 媒体生命周期");
  const first = await stageImport(page, tripId, "e09-media.csv", [
    ["1", "媒体生命周期", `${readyMediaUrl};${failedMediaUrl};${failedMediaUrl};${failedMediaUrl}`],
  ]);
  let tasks = await listMediaTasks(page, first.id);
  expect(tasks).toHaveLength(4);

  const [readyTask, failedTask, rejectedTask, heldTask] = tasks;
  await decideMedia(page, first.id, readyTask!.id, "approve");
  await decideMedia(page, first.id, failedTask!.id, "approve");
  await decideMedia(page, first.id, rejectedTask!.id, "reject");

  const commit = await page.request.post(`${apiOrigin}/api/v1/imports/${first.id}/commit`, {
    headers: { "idempotency-key": "e09-media-aggregate" },
  });
  expect(commit.ok(), await commit.text()).toBe(true);

  await expect.poll(async () => (await getJson<{ status: string }>(page, `/api/v1/imports/${first.id}/commit`)).status, {
    timeout: 120_000,
    intervals: [250, 500, 1_000, 2_000],
  }).toBe("processing_media");

  await expect.poll(async () => {
    const current = await listMediaTasks(page, first.id);
    return current.filter(({ status }) => ["ready", "failed", "rejected"].includes(status)).length;
  }, { timeout: 120_000, intervals: [250, 500, 1_000] }).toBe(3);
  expect((await listMediaTasks(page, first.id)).map(({ status }) => status).sort()).toEqual([
    "awaiting_approval", "failed", "ready", "rejected",
  ]);

  await decideMedia(page, first.id, heldTask!.id, "approve");
  await expect.poll(async () => {
    return (await getJson<{ status: string }>(page, `/api/v1/imports/${first.id}/commit`)).status;
  }, {
    timeout: 120_000,
    intervals: [250, 500, 1_000, 2_000],
  }).toBe("completed_with_warnings");

  tasks = await waitForTerminalMediaTasks(page, first.id);
  expect(tasks.map(({ status }) => status).sort()).toEqual(["failed", "failed", "ready", "rejected"]);
  const ready = tasks.find(({ status }) => status === "ready");
  expect(ready).toMatchObject({
    itineraryItemId: expect.any(String),
    attachmentId: expect.any(String),
  });
  expect(ready?.errorCode ?? null).toBeNull();

  const preview = await getJson<{ rows: Array<{ status: string }> }>(
    page,
    `/api/v1/imports/${first.id}/preview?page=1&pageSize=10`,
  );
  expect(preview.rows).toHaveLength(1);
  expect(preview.rows[0]?.status).toBe("imported");

  const second = await stageImport(page, tripId, "e09-media-cancel.csv", [
    ["1", "取消后续跑", failedMediaUrl],
  ]);
  const secondCommit = await page.request.post(`${apiOrigin}/api/v1/imports/${second.id}/commit`, {
    headers: { "idempotency-key": "e09-media-cancel" },
  });
  expect(secondCommit.ok(), await secondCommit.text()).toBe(true);
  await expect.poll(async () => {
    return (await getJson<{ status: string }>(page, `/api/v1/imports/${second.id}/commit`)).status;
  }, { timeout: 60_000, intervals: [250, 500, 1_000] }).toBe("processing_media");

  const cancelled = await page.request.post(`${apiOrigin}/api/v1/imports/${second.id}/cancel`);
  expect(cancelled.ok(), await cancelled.text()).toBe(true);
  await expect.poll(async () => {
    return (await getJson<{ status: string }>(page, `/api/v1/imports/${second.id}/commit`)).status;
  }, {
    timeout: 60_000,
    intervals: [250, 500, 1_000],
  }).toBe("cancelled");

  const resumed = await page.request.post(`${apiOrigin}/api/v1/imports/${second.id}/resume`);
  expect(resumed.ok(), await resumed.text()).toBe(true);
  const resumedJob = await resumed.json() as { id: string; resumedFromJobId: string; status: string };
  expect(resumedJob).toMatchObject({ resumedFromJobId: second.id });
  await expect.poll(async () => {
    return (await getJson<{ status: string }>(page, `/api/v1/imports/${resumedJob.id}/commit`)).status;
  }, {
    timeout: 60_000,
    intervals: [250, 500, 1_000],
  }).toMatch(/^(completed|completed_with_warnings)$/u);
  expect((await listMediaTasks(page, second.id)).map(({ status }) => status)).toEqual(["cancelled"]);
  expect(await listMediaTasks(page, resumedJob.id)).toEqual([]);
});

async function stageImport(page: Page, tripId: string, filename: string, rows: string[][]) {
  const mapping = page.getByRole("region", { name: "导入映射工作台" });
  const csv = ["Day,Target,ImageURLs", ...rows.map((row) => row.join(",")), ""].join("\n");
  await mapping.getByLabel("上传行程文件").setInputFiles({
    name: filename,
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await expect(mapping.getByRole("status").filter({ hasText: "已生成真实 ImportJob" })).toBeVisible({ timeout: 45_000 });
  await mapping.getByRole("button", { name: "保存映射" }).click();
  await expect.poll(async () => {
    return (await getJson<{ id: string; status: string }>(page, `/api/v1/trips/${tripId}/imports/latest`)).status;
  }, {
    timeout: 60_000,
    intervals: [250, 500, 1_000],
  }).toBe("ready_to_import");
  return getJson<{ id: string; status: string }>(page, `/api/v1/trips/${tripId}/imports/latest`);
}

async function listMediaTasks(page: Page, jobId: string) {
  return getJson<Array<MediaTask>>(page, `/api/v1/imports/${jobId}/media-tasks`);
}

async function waitForTerminalMediaTasks(page: Page, jobId: string) {
  let latest: MediaTask[] = [];
  await expect.poll(async () => {
    latest = await listMediaTasks(page, jobId);
    return latest.every(({ status }) => ["ready", "failed", "rejected", "cancelled"].includes(status));
  }, {
    timeout: 120_000,
    intervals: [250, 500, 1_000, 2_000],
  }).toBe(true);
  return latest;
}

async function decideMedia(page: Page, jobId: string, taskId: string, decision: "approve" | "reject") {
  const response = await page.request.post(
    `${apiOrigin}/api/v1/imports/${jobId}/media-tasks/${taskId}/${decision}`,
    decision === "reject" ? { data: { reason: "E09 lifecycle coverage" } } : undefined,
  );
  expect(response.ok(), await response.text()).toBe(true);
}

type MediaTask = {
  id: string;
  status: string;
  itineraryItemId: string | null;
  attachmentId: string | null;
  errorCode: string | null;
};

async function getJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`${apiOrigin}${path}`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}
