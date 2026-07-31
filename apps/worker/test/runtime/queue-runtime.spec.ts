import { describe, expect, test, vi } from "vitest";

import {
  APPLICATION_QUEUE,
  createQueueProcess,
  defaultApplicationProcessor,
} from "../../src/queue-runtime.js";

describe("REVIEW-P0-01 application Worker composition root", () => {
  test("consumes the application queue and drains before close", async () => {
    const events: string[] = [];
    const processRuntime = createQueueProcess({
      redisUrl: "redis://127.0.0.1:6379",
      consumerFactory(queueName) {
        expect(queueName).toBe(APPLICATION_QUEUE);
        return {
          pause: vi.fn(async () => { events.push("pause"); }),
          close: vi.fn(async () => { events.push("close"); }),
        };
      },
    });
    await processRuntime.close();
    await processRuntime.close();
    expect(events).toEqual(["pause", "close"]);
  });

  test("unknown job types fail explicitly instead of being acknowledged", async () => {
    await expect(defaultApplicationProcessor({
      name: "unknown",
    } as never)).rejects.toMatchObject({
      code: "WORKER_PROCESSOR_UNSUPPORTED",
      retryable: false,
    });
  });
});
