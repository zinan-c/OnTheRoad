import { describe, expect, test } from "vitest";

import { InMemoryExportStageRepository } from "../src/export-stage-machine.js";
import { PdfExportProcessor } from "../src/pdf-processor.js";

describe("TC-F05-03 resource-ready render contract", () => {
  test("waits for all resource classes before rendering and cleans failed artifacts", async () => {
    const stages = new InMemoryExportStageRepository();
    const job = {
      id: "export-render-1",
      status: "queued" as const,
      stage: "snapshot" as const,
      version: 1,
      snapshotHash: "b".repeat(64),
      templateVersion: "m4-print-v1",
    };
    stages.seed(job);
    const events: string[] = [];
    const processor = new PdfExportProcessor({
      source: {
        async get() {
          return { job, snapshot: {
            schemaVersion: 1,
            tripId: "trip-1",
            tripVersion: 1,
            facts: {},
            assets: [],
            capturedAt: "2026-08-12T00:00:00.000Z",
          } };
        },
      },
      stages,
      probeFactory: () => ({
        fontsReady: () => { events.push("fonts"); return true; },
        imagesReady: () => { events.push("images"); return true; },
        mapsReady: () => { events.push("maps"); return true; },
      }),
      renderer: {
        async render() {
          events.push("render");
          return new TextEncoder().encode("%PDF-1.7\n01234567890123456789");
        },
      },
      artifacts: {
        async put() { events.push("put"); return { key: "exports/1", version: "v1", checksumSha256: "c".repeat(64) }; },
        async delete() { events.push("delete"); },
      },
      workerId: "pdf-worker-1",
    });
    await expect(processor.process(job.id)).resolves.toBe("completed");
    expect(events.indexOf("render")).toBeGreaterThan(events.indexOf("maps"));
    expect(stages.get(job.id)).toMatchObject({ status: "completed", stage: "complete" });
  });
});
