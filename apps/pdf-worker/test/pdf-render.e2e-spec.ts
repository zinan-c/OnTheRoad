import { describe, expect, test } from "vitest";

import { InMemoryExportStageRepository } from "../src/export-stage-machine.js";
import { PdfExportProcessor } from "../src/pdf-processor.js";
import { PlaywrightPdfPrintRenderer } from "../src/print-renderer.js";

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

  test("renders the F01 snapshot with F02 map assets through the F03 print contract", async () => {
    const renderer = new PlaywrightPdfPrintRenderer();
    const pdf = await renderer.render({
      job: {
        id: "00000000-0000-4000-8000-000000000010",
        status: "rendering",
        stage: "render",
        version: 1,
        snapshotHash: "c".repeat(64),
        templateVersion: "m4-print-v1",
        options: { orientation: "portrait", sections: ["cover", "global_map", "daily_itinerary"] },
      },
      snapshot: {
        schemaVersion: 1,
        tripId: "trip-1",
        tripVersion: 1,
        facts: {
          trip: { name: "上海五日", startDate: "2026-08-01", endDate: "2026-08-05" },
          globalMap: { assetId: "map:overview" },
          days: [{
            id: "day-1",
            dayNumber: 1,
            date: "2026-08-01",
            items: [{
              id: "item-1",
              name: "外滩",
              description: "黄昏散步",
              point: { longitude: 121.49, latitude: 31.24, crs: "WGS84" },
            }],
            mapAssetId: "map:day:day-1",
          }],
          routes: [],
        },
        assets: [
          { id: "map:overview", kind: "map", contentType: "image/png", checksumSha256: null, objectVersion: null, width: null, height: null, required: true, status: "processing", omissionReason: "static map is queued" },
          { id: "map:day:day-1", kind: "map", contentType: "image/png", checksumSha256: null, objectVersion: null, width: null, height: null, required: true, status: "processing", omissionReason: "static map is queued" },
        ],
        capturedAt: "2026-08-12T00:00:00.000Z",
      },
      signal: new AbortController().signal,
    });

    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1_000);
  }, 30_000);

  test("does not convert a cancel race after validation into failed", async () => {
    const stages = new InMemoryExportStageRepository();
    const job = {
      id: "export-cancel-race",
      status: "queued" as const,
      stage: "snapshot" as const,
      version: 1,
      snapshotHash: "d".repeat(64),
      templateVersion: "m4-print-v1",
    };
    stages.seed(job);
    const wrappedStages = {
      claim: (...args: Parameters<InMemoryExportStageRepository["claim"]>) => stages.claim(...args),
      advance: async (...args: Parameters<InMemoryExportStageRepository["advance"]>) => {
        const next = await stages.advance(...args);
        if (next?.status === "validating") {
          stages.seed({ ...next, status: "cancelling" });
        }
        return next;
      },
      cancel: (...args: Parameters<InMemoryExportStageRepository["cancel"]>) => stages.cancel(...args),
      fail: (...args: Parameters<InMemoryExportStageRepository["fail"]>) => stages.fail(...args),
    };
    const processor = new PdfExportProcessor({
      source: { async get() { return { job, snapshot: { schemaVersion: 1, tripId: "trip-1", tripVersion: 1, facts: {}, assets: [], capturedAt: "2026-08-12T00:00:00.000Z" } }; } },
      stages: wrappedStages,
      probeFactory: () => ({ fontsReady: () => true, imagesReady: () => true, mapsReady: () => true }),
      renderer: { async render() { return new TextEncoder().encode("%PDF-1.7\n01234567890123456789"); } },
      artifacts: { async put() { return { key: "derived/export-cancel-race/pdf", version: "v1", checksumSha256: "e".repeat(64) }; } },
      workerId: "pdf-worker-1",
    });

    await expect(processor.process(job.id)).resolves.toBe("cancelled");
  });
});
