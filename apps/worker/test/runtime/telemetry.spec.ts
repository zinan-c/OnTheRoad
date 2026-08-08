import { describe, expect, test } from "vitest";
import { InMemoryTelemetrySink } from "@on-the-road/observability";

import {
  createWorkerTelemetry,
  recordWorkerPipeline,
} from "../../src/telemetry.js";

describe("M3 Worker telemetry", () => {
  test("records bounded queue outcome and duration without entity labels", () => {
    const sink = new InMemoryTelemetrySink();
    const telemetry = createWorkerTelemetry([sink]);

    recordWorkerPipeline(telemetry, {
      queue: "otr:import-stage",
      outcome: "failed",
      durationMs: 25,
      errorCode: "ImportValidationError",
    });

    expect(sink.entries.map(({ kind, name }) => `${kind}:${name}`)).toEqual([
      "log:worker.pipeline.failed",
      "metric:queue.jobs",
      "metric:queue.duration",
      "span:worker.pipeline.completed",
    ]);
    expect(telemetry.metrics.snapshot()).toEqual([
      {
        name: "queue.jobs",
        value: 1,
        labels: { queue: "otr:import-stage", outcome: "failed" },
      },
      {
        name: "queue.duration",
        value: 25,
        labels: { queue: "otr:import-stage", outcome: "failed" },
      },
    ]);
    expect(JSON.stringify(sink.entries)).not.toMatch(/jobId|ownerId|tripId/u);
  });
});
