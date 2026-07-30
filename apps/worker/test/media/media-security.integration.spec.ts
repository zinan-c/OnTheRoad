import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import { ClamAvTcpScanner } from "../../src/processors/media/clamav-scanner.js";
import {
  InMemoryMediaRepository,
  InMemoryMediaStorage,
  MediaPipeline,
} from "../../src/processors/media/media-pipeline.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const EICAR = Buffer.from(
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
  "ascii",
);

function checksum(value: Buffer): string {
  return createHash("sha256").update(value).digest("base64");
}

function setup(
  body: Buffer,
  overrides: {
    contentType?: string;
    scanner?: { scan(value: Buffer): Promise<{ clean: true } | { clean: false; signature: string }> };
    dimensions?: { width: number; height: number };
  } = {},
) {
  const attachment = {
    id: "attachment-security",
    ownerId: "owner-01",
    objectKey: "attachments/owner/upload-security",
    objectVersion: "upload-version-security",
    checksumSha256: checksum(body),
    contentType: overrides.contentType ?? "image/png",
    contentLength: body.byteLength,
    status: "uploaded" as const,
    version: 2,
  };
  const repository = new InMemoryMediaRepository([attachment]);
  const storage = new InMemoryMediaStorage();
  storage.seedQuarantine(attachment.objectKey, attachment.objectVersion, body);
  const dimensions = overrides.dimensions ?? { width: 1, height: 1 };
  const pipeline = new MediaPipeline({
    repository,
    storage,
    scanner: overrides.scanner ?? { scan: async () => ({ clean: true }) },
    imageProcessor: {
      process: async () => ({
        detectedContentType: body === PNG ? "image/png" : "application/octet-stream",
        ...dimensions,
        thumbnail: PNG,
        thumbnailContentType: "image/png",
      }),
    },
  });
  return { attachment, pipeline, repository, storage };
}

describe("TC-D02-02 malware, MIME, image bomb and fail-closed", () => {
  test.each([
    {
      name: "wrong MIME",
      context: setup(EICAR, { contentType: "image/png" }),
      code: "MEDIA_MAGIC_MISMATCH",
    },
    {
      name: "EICAR",
      context: setup(PNG, {
        scanner: {
          scan: async () => ({ clean: false, signature: "Eicar-Signature" }),
        },
      }),
      code: "MEDIA_MALWARE_DETECTED",
    },
    {
      name: "decode bomb",
      context: setup(PNG, {
        dimensions: { width: 100_000, height: 100_000 },
      }),
      code: "MEDIA_DIMENSIONS_EXCEEDED",
    },
    {
      name: "scanner unavailable",
      context: setup(PNG, {
        scanner: {
          scan: async () => {
            throw new Error("scanner unavailable");
          },
        },
      }),
      code: "MEDIA_SCANNER_UNAVAILABLE",
    },
  ])("fails closed for $name", async ({ context, code }) => {
    await expect(context.pipeline.process(context.attachment.id)).rejects.toMatchObject({
      code,
    });
    expect(context.repository.get(context.attachment.id)).toMatchObject({
      status: "failed",
      errorCode: code,
    });
    expect(context.storage.publicKeys()).toEqual([]);
    expect(
      context.storage.canReadPublicly(context.attachment.objectKey),
    ).toBe(false);
  });

  test.skipIf(process.env.OTR_RUN_CLAMAV_INTEGRATION !== "1")(
    "uses real ClamAV signatures for benign and EICAR streams",
    async () => {
      const scanner = new ClamAvTcpScanner({
        host: process.env.CLAMAV_HOST ?? "127.0.0.1",
        port: Number(process.env.CLAMAV_PORT ?? "3310"),
      });

      await expect(scanner.scan(PNG)).resolves.toEqual({ clean: true });
      await expect(scanner.scan(EICAR)).resolves.toMatchObject({
        clean: false,
        signature: expect.stringMatching(/Eicar/u),
      });
    },
  );
});
