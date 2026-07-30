import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { S3ObjectStorage } from "../../../../packages/storage/src/index.js";
import {
  startNativeMinio,
  type NativeMinio,
} from "../../../../packages/storage/test/native-minio.js";
import { ImageMagickProcessor } from "../../src/processors/media/imagemagick-processor.js";
import {
  InMemoryMediaRepository,
  InMemoryMediaStorage,
  MediaPipeline,
} from "../../src/processors/media/media-pipeline.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
let minio: NativeMinio;

beforeAll(async () => {
  minio = await startNativeMinio();
});

afterAll(async () => {
  await minio?.stop();
});

function checksum(value: Buffer): string {
  return createHash("sha256").update(value).digest("base64");
}

describe("TC-D02-01 safe image pipeline", () => {
  test("moves an immutable upload through processing to ready", async () => {
    const attachment = {
      id: "attachment-01",
      ownerId: "owner-01",
      objectKey: "attachments/owner/upload-01",
      objectVersion: "upload-version-01",
      checksumSha256: checksum(PNG),
      contentType: "image/png",
      contentLength: PNG.byteLength,
      status: "uploaded" as const,
      version: 2,
    };
    const repository = new InMemoryMediaRepository([attachment]);
    const storage = new InMemoryMediaStorage();
    storage.seedQuarantine(
      attachment.objectKey,
      attachment.objectVersion,
      PNG,
    );
    const pipeline = new MediaPipeline({
      repository,
      storage,
      scanner: { scan: async () => ({ clean: true as const }) },
      imageProcessor: {
        process: async () => ({
          detectedContentType: "image/png",
          width: 1,
          height: 1,
          thumbnail: PNG,
          thumbnailContentType: "image/png",
        }),
      },
      keyFactory: () => "derivative-01",
    });

    const result = await pipeline.process(attachment.id);

    expect(result).toMatchObject({
      status: "ready",
      objectVersion: "upload-version-01",
      checksumSha256: attachment.checksumSha256,
      contentLength: PNG.byteLength,
      width: 1,
      height: 1,
      thumbnailKey: "derived/attachment-01/derivative-01",
      thumbnailChecksumSha256: attachment.checksumSha256,
    });
    expect(repository.history(attachment.id).map(({ status }) => status)).toEqual([
      "uploaded",
      "processing",
      "ready",
    ]);
    expect(storage.publicKeys()).toEqual([
      "derived/attachment-01/derivative-01",
    ]);
  });

  test("decodes a real image and creates a stripped thumbnail", async () => {
    const result = await new ImageMagickProcessor().process(PNG);

    expect(result).toMatchObject({
      detectedContentType: "image/png",
      width: 1,
      height: 1,
      thumbnailContentType: "image/png",
    });
    expect(result.thumbnail.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  test("processes an immutable native MinIO version into a derivative", async () => {
    const storage = new S3ObjectStorage({
      endpoint: minio.endpoint,
      region: "local",
      bucket: minio.bucket,
      accessKey: minio.accessKey,
      secretKey: minio.secretKey,
      keyFactory: () => "00000000-0000-4000-8000-000000000202",
    });
    const checksumSha256 = checksum(PNG);
    const session = storage.createUploadSession({
      ownerId: "owner-native",
      contentType: "image/png",
      contentLength: PNG.byteLength,
      checksumSha256,
    });
    const upload = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: session.headers,
      body: PNG,
    });
    expect(upload.ok).toBe(true);
    const metadata = await storage.inspectObject(session.objectKey);
    const repository = new InMemoryMediaRepository([{
      id: "00000000-0000-4000-8000-000000000203",
      ownerId: "owner-native",
      objectKey: metadata.objectKey,
      objectVersion: metadata.objectVersion,
      checksumSha256: metadata.checksumSha256,
      contentType: metadata.contentType,
      contentLength: metadata.contentLength,
      status: "uploaded",
      version: 2,
    }]);
    const pipeline = new MediaPipeline({
      repository,
      storage,
      scanner: { scan: async () => ({ clean: true }) },
      imageProcessor: new ImageMagickProcessor(),
      keyFactory: () => "00000000-0000-4000-8000-000000000204",
    });

    await expect(
      pipeline.process("00000000-0000-4000-8000-000000000203"),
    ).resolves.toMatchObject({
      status: "ready",
      objectVersion: metadata.objectVersion,
      checksumSha256,
      width: 1,
      height: 1,
      thumbnailKey:
        "derived/00000000-0000-4000-8000-000000000203/00000000-0000-4000-8000-000000000204",
    });
  });
});
