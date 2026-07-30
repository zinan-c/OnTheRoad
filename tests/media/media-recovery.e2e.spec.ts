import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import { MediaRecoveryCoordinator } from "../../apps/worker/src/processors/media/media-recovery.js";
import {
  InMemoryMediaRepository,
  InMemoryMediaStorage,
  MediaPipeline,
} from "../../apps/worker/src/processors/media/media-pipeline.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("TC-D02-03 retry and orphan reconciliation", () => {
  test("requeues a killed worker, removes only its orphan, and reaches one ready result", async () => {
    const attachment = {
      id: "00000000-0000-4000-8000-000000000201",
      ownerId: "owner-01",
      objectKey: "attachments/owner/upload-recovery",
      objectVersion: "upload-version-recovery",
      checksumSha256: createHash("sha256").update(PNG).digest("base64"),
      contentType: "image/png",
      contentLength: PNG.byteLength,
      status: "uploaded" as const,
      version: 2,
    };
    const repository = new InMemoryMediaRepository([attachment]);
    const storage = new InMemoryMediaStorage();
    storage.seedQuarantine(attachment.objectKey, attachment.objectVersion, PNG);

    const abandoned = repository.claim(attachment.id);
    await storage.putImmutable(
      `derived/${attachment.id}/abandoned`,
      PNG,
      "image/png",
    );
    await storage.putImmutable(
      "derived/00000000-0000-4000-8000-000000000999/keep",
      PNG,
      "image/png",
    );

    await new MediaRecoveryCoordinator({ repository, storage }).requeueStale(
      attachment.id,
      abandoned.version,
    );
    const pipeline = new MediaPipeline({
      repository,
      storage,
      scanner: { scan: async () => ({ clean: true }) },
      imageProcessor: {
        process: async () => ({
          detectedContentType: "image/png",
          width: 1,
          height: 1,
          thumbnail: PNG,
          thumbnailContentType: "image/png",
        }),
      },
      keyFactory: () => "current",
    });

    await expect(pipeline.process(attachment.id)).resolves.toMatchObject({
      status: "ready",
      thumbnailKey: `derived/${attachment.id}/current`,
    });
    expect(storage.publicKeys()).toEqual([
      `derived/${attachment.id}/current`,
      "derived/00000000-0000-4000-8000-000000000999/keep",
    ]);
    expect(repository.history(attachment.id).filter(({ status }) =>
      status === "ready")).toHaveLength(1);
  });
});
