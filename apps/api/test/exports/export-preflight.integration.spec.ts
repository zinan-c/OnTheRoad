import { describe, expect, test } from "vitest";

import { PostgresExportService } from "../../src/modules/exports/service.mjs";
import {
  attachment,
  exportState,
  FakeExportDatabase,
  mediaTask,
} from "./fake-export-database";

const tripId = "00000000-0000-4000-8000-000000000001";
const mediaStatuses = [
  "awaiting_approval",
  "approved",
  "queued",
  "fetching",
  "quarantined",
  "scanning",
  "processing",
  "retry_scheduled",
  "failed",
  "rejected",
  "cancelling",
  "cancelled",
  "ready",
] as const;
const attachmentStatuses = ["pending", "uploaded", "processing", "failed", "ready"] as const;

describe("TC-F01-02 export media preflight matrix/race", () => {
  test.each(mediaStatuses)("require_all treats MediaTask %s as one selected asset", async (status) => {
    const state = exportState({
      mediaTasks: [mediaTask(status, `media-${status}`, status === "ready" ? "attachment-ready" : null)],
      attachments: status === "ready" ? [attachment("ready", "attachment-ready")] : [],
    });
    const service = new PostgresExportService({ database: new FakeExportDatabase(state) });

    const preview = await service.preview("owner-1", tripId, {
      sections: ["gallery"],
      mediaPolicy: "require_all",
    });
    const image = preview.assets.find(({ kind }) => kind === "image");
    expect(image).toBeDefined();
    if (status === "ready") {
      expect(image).toMatchObject({ status: "ready", omissionReason: null });
      expect(preview.blockingAssets).toEqual([]);
    } else {
      expect(image).toMatchObject({ required: true, status: expect.not.stringMatching(/^ready$/u) });
      expect(preview.blockingAssets).toEqual([image]);
    }
  });

  test.each(attachmentStatuses)("require_all treats Attachment %s as non-ready unless immutable media is ready", async (status) => {
    const state = exportState({ attachments: [attachment(status)] });
    const service = new PostgresExportService({ database: new FakeExportDatabase(state) });
    const preview = await service.preview("owner-1", tripId, {
      sections: ["gallery"],
      mediaPolicy: "require_all",
    });
    if (status === "ready") expect(preview.blockingAssets).toEqual([]);
    else expect(preview.blockingAssets).toHaveLength(1);
  });

  test("ready_only fixes the omission list in the snapshot and still creates a queued Job", async () => {
    const state = exportState({
      mediaTasks: [mediaTask("failed")],
    });
    const queue = { add: async () => ({}) };
    const service = new PostgresExportService({ database: new FakeExportDatabase(state), queue });
    const job = await service.create("owner-1", tripId, {
      idempotencyKey: "f01-ready-only",
      sections: ["gallery"],
      mediaPolicy: "ready_only",
    });

    expect(job.status).toBe("queued");
    expect(job.omissionCount).toBe(1);
    expect(job.warnings).toEqual([
      expect.objectContaining({ assetId: "media-task:media-task-1" }),
    ]);
    expect(job.snapshot.assets).toEqual([
      expect.objectContaining({
        id: "media-task:media-task-1",
        status: "failed",
        omissionReason: expect.stringContaining("MEDIA_IMPORT_FAILED"),
      }),
    ]);
  });

  test("repeatable-read snapshot does not mix a ready attachment with a concurrent update/delete", async () => {
    const state = exportState({ attachments: [attachment("ready")] });
    let attachmentRead = false;
    const database = new FakeExportDatabase(state, {
      onSnapshotQuery: (entity) => {
        if (entity !== "attachment" || attachmentRead) return;
        attachmentRead = true;
        state.attachments[0]!.status = "failed";
        state.attachments[0]!.object_version = null;
        state.attachments[0]!.checksum_sha256 = null;
      },
    });
    const service = new PostgresExportService({ database });
    const first = await service.preview("owner-1", tripId, {
      sections: ["gallery"],
      mediaPolicy: "require_all",
    });
    expect(first.assets).toEqual([
      expect.objectContaining({ id: "attachment:attachment-1", status: "ready" }),
    ]);
    expect(first.blockingAssets).toEqual([]);

    const second = await service.preview("owner-1", tripId, {
      sections: ["gallery"],
      mediaPolicy: "require_all",
    });
    expect(second.assets).toEqual([
      expect.objectContaining({ id: "attachment:attachment-1", status: "failed" }),
    ]);
    expect(second.blockingAssets).toHaveLength(1);
  });
});
