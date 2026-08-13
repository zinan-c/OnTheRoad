import { describe, expect, test } from "vitest";

import type { ExportSnapshot } from "../../../packages/application/src/export/contracts.js";
import { buildPrintChapters, buildPrintManifest } from "../../../packages/application/src/export/print.js";
import { PostgresExportService } from "../../../apps/api/src/modules/exports/service.mjs";
import { attachment, exportState, FakeExportDatabase } from "../../../apps/api/test/exports/fake-export-database.js";
import { InMemoryExportStageRepository } from "../../../apps/pdf-worker/src/export-stage-machine.js";
import { PdfExportProcessor } from "../../../apps/pdf-worker/src/pdf-processor.js";
import { renderPrintHtml } from "../../../apps/pdf-worker/src/print-renderer.js";

const tripId = "00000000-0000-4000-8000-000000000001";
const sections = ["cover", "global_map", "daily_itinerary", "daily_map", "gallery", "expenses", "notes", "omissions"] as const;

describe("TC-M4-INT-03 frozen snapshot PDF rehearsal", () => {
  test("prints the creation snapshot after Trip edits and does not expose a cancelled artifact", async () => {
    const state = exportState({
      attachments: [attachment("ready")],
    });
    const queue: unknown[][] = [];
    const service = new PostgresExportService({
      database: new FakeExportDatabase(state),
      queue: { add: async (...args: unknown[]) => { queue.push(args); return {}; } },
    });
    const created = await service.create("owner-1", tripId, {
      idempotencyKey: "m4-rehearsal-1",
      sections: [...sections],
      mediaPolicy: "ready_only",
      orientation: "landscape",
    });
    const frozen = created.snapshot as ExportSnapshot;
    expect(created.status).toBe("queued");
    expect(created.snapshotHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(queue).toHaveLength(1);

    state.trip.name = "Edited after ExportJob";
    state.trip.version = 4;
    state.items[0]!.target = "Edited after ExportJob";
    const manifest = buildPrintManifest(frozen, buildPrintChapters(frozen, sections));
    const html = renderPrintHtml(frozen, sections, [], "", "landscape", {
      templateVersion: created.templateVersion,
      snapshotHash: created.snapshotHash,
    });
    expect(html).toContain("Fixture trip");
    expect(html).not.toContain("Edited after ExportJob");
    expect(html).toContain(`data-snapshot-hash="${created.snapshotHash}"`);
    expect(html).toContain(JSON.stringify(manifest.referencedAssetIds).replaceAll('"', "&quot;"));

    const workerJob = {
      id: created.id,
      status: "queued" as const,
      stage: "snapshot" as const,
      version: 1,
      snapshotHash: created.snapshotHash,
      templateVersion: created.templateVersion,
      options: { orientation: "landscape" as const, sections: [...sections] },
    };
    const stages = new InMemoryExportStageRepository();
    stages.seed(workerJob);
    const renderedSnapshots: ExportSnapshot[] = [];
    const artifacts: string[] = [];
    const processor = new PdfExportProcessor({
      source: { async get() { return { job: workerJob, snapshot: frozen }; } },
      stages,
      probeFactory: () => ({ fontsReady: () => true, imagesReady: () => true, mapsReady: () => true }),
      renderer: {
        async render(input) {
          renderedSnapshots.push(input.snapshot);
          return new TextEncoder().encode("%PDF-1.7\nM4 rehearsal");
        },
      },
      artifacts: {
        async put() {
          artifacts.push("created");
          return { key: `exports/${created.id}`, version: "v1", checksumSha256: "b".repeat(64) };
        },
      },
      workerId: "m4-pdf-worker",
    });
    await expect(processor.process(created.id)).resolves.toBe("completed");
    expect(stages.get(created.id)).toMatchObject({ status: "completed", stage: "complete" });
    expect(renderedSnapshots).toHaveLength(1);
    expect(renderedSnapshots[0]).toBe(frozen);
    expect(artifacts).toEqual(["created"]);

    const cancelStages = new InMemoryExportStageRepository();
    const cancelledJob = {
      ...workerJob,
      id: "m4-cancelled-export",
      status: "cancelling" as const,
      stage: "render" as const,
    };
    cancelStages.seed(cancelledJob);
    let renderedAfterCancel = false;
    const cancelledProcessor = new PdfExportProcessor({
      source: { async get() { return { job: cancelledJob, snapshot: frozen }; } },
      stages: cancelStages,
      probeFactory: () => ({ fontsReady: () => true, imagesReady: () => true, mapsReady: () => true }),
      renderer: {
        async render() {
          renderedAfterCancel = true;
          return new TextEncoder().encode("%PDF-1.7\nshould not render");
        },
      },
      artifacts: { async put() { throw new Error("cancelled job must not upload"); } },
      workerId: "m4-pdf-worker",
    });
    await expect(cancelledProcessor.process(cancelledJob.id)).resolves.toBe("cancelled");
    expect(renderedAfterCancel).toBe(false);
    expect(cancelStages.get(cancelledJob.id)).toMatchObject({ status: "cancelled", stage: "complete" });
  });
});
