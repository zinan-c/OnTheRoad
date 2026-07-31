import { describe, expect, test, vi } from "vitest";

import {
  createPdfQueueProcess,
  defaultPdfProcessor,
  PDF_QUEUE,
} from "../../src/queue-runtime.js";

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
});
