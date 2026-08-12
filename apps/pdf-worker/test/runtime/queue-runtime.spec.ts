import { describe, expect, test, vi } from "vitest";

import {
  createPdfQueueProcess,
  defaultPdfProcessor,
  PDF_QUEUE,
} from "../../src/queue-runtime.js";
import { createExportQueueProcessor } from "../../src/export-queue-processor.js";

describe("REVIEW-P0-01 PDF Worker composition root", () => {
  test("uses a dedicated queue and drains before close", async () => {
    const events: string[] = [];
    const processRuntime = createPdfQueueProcess({
      redisUrl: "redis://127.0.0.1:6379",
      consumerFactory(queueName) {
        expect(queueName).toBe(PDF_QUEUE);
        return {
          pause: vi.fn(async () => { events.push("pause"); }),
          close: vi.fn(async () => { events.push("close"); }),
        };
      },
    });
    await processRuntime.close();
    expect(events).toEqual(["pause", "close"]);
  });

  test("unknown PDF jobs remain failed and retry policy-owned", async () => {
    await expect(defaultPdfProcessor({
      name: "unknown",
    } as never)).rejects.toMatchObject({
      code: "PDF_PROCESSOR_UNSUPPORTED",
      retryable: false,
    });
  });

  test("dispatches export.render jobs to the real export processor", async () => {
    const process = vi.fn(async (jobId: string) => ({ status: "completed", jobId }));
    const processor = createExportQueueProcessor({ process });
    const result = await processor({
      name: "export.render",
      data: { exportJobId: "export-1" },
    } as never);

    expect(result).toEqual({ status: "completed", jobId: "export-1" });
    expect(process).toHaveBeenCalledWith("export-1");
  });

  test("rejects an export.render job without a durable export id", async () => {
    const processor = createExportQueueProcessor({ process: vi.fn() });
    await expect(processor({ name: "export.render", data: {} } as never)).rejects.toMatchObject({
      code: "PDF_EXPORT_JOB_ID_REQUIRED",
    });
  });
});
