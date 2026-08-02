import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { S3ObjectStorage } from "@on-the-road/storage";
import {
  AttachmentGalleryService,
  InMemoryAttachmentGalleryRepository,
} from "../../../../apps/api/src/modules/attachments/gallery.mjs";
import {
  startNativeMinio,
  type NativeMinio,
} from "../../../../packages/storage/test/native-minio.js";

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

describe("D03 real upload/gallery evidence", () => {
  test("uploads to MinIO, reads immutable metadata, and applies gallery order metadata", async () => {
    const storage = new S3ObjectStorage({
      endpoint: minio.endpoint,
      region: "local",
      bucket: minio.bucket,
      accessKey: minio.accessKey,
      secretKey: minio.secretKey,
    });
    const checksumSha256 = createHash("sha256").update(PNG).digest("base64");
    const session = storage.createUploadSession({
      ownerId: "m3-owner",
      contentType: "image/png",
      contentLength: PNG.byteLength,
      checksumSha256,
    });

    const upload = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: session.headers,
      body: PNG,
    });
    expect(upload.status).toBe(200);
    const object = await storage.inspectObject(session.objectKey);
    expect(object).toMatchObject({
      objectKey: session.objectKey,
      checksumSha256,
      contentLength: PNG.byteLength,
      contentType: "image/png",
    });
    expect(object.objectVersion).toBeTruthy();

    const gallery = new AttachmentGalleryService(
      new InMemoryAttachmentGalleryRepository([
        {
          id: "attachment-m3",
          ownerId: "m3-owner",
          itemId: "item-m3",
          objectKey: object.objectKey,
          objectVersion: object.objectVersion,
          status: "ready",
          sortOrder: 0,
          version: 1,
          caption: "",
          isCover: false,
        },
      ]),
    );
    expect(gallery.update("m3-owner", "attachment-m3", 1, {
      caption: "抵达",
      isCover: true,
    })).toMatchObject({
      caption: "抵达",
      isCover: true,
      version: 2,
      objectVersion: object.objectVersion,
    });
  });
});
