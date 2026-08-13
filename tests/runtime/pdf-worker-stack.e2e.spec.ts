import { randomUUID } from "node:crypto";

import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { EXPORT_QUEUE_NAME } from "../../packages/application/src/export/contracts.ts";

const redisUrl = process.env.OTR_RUNTIME_SMOKE_REDIS_URL ?? process.env.REDIS_URL;
const queueName = EXPORT_QUEUE_NAME;
let queue: Queue;
let connection: Redis;

async function eventually(
  assertion: () => Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("PDF Worker queue smoke did not complete before timeout.");
}

beforeAll(async () => {
  if (!redisUrl) throw new Error("A real Redis URL is required for PDF Worker queue smoke.");
  connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  queue = new Queue(queueName, { connection });
  await queue.waitUntilReady();
});

afterAll(async () => {
  await queue?.close();
  connection?.disconnect();
});

describe("REVIEW-P0-01 real PDF Worker queue smoke", () => {
  test("consumes a production PDF queue job and persists completed state", async () => {
      const jobId = `m4-pdf-worker-smoke-${randomUUID()}`;
      const job = await queue.add(
        "runtime.noop",
        { source: "m4-gate" },
        { jobId, attempts: 1, removeOnComplete: false, removeOnFail: false },
      );

      try {
        await eventually(async () => (await (await queue.getJob(jobId))?.getState()) === "completed");
        const completed = await queue.getJob(jobId);
        expect(completed?.returnvalue).toEqual({ ok: true, jobId });
      } finally {
        await queue.remove(job.id!);
      }
    }, 20_000);
});
