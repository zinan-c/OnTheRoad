import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { S3ObjectStorage } from "../src/index.js";
import { startNativeMinio, type NativeMinio } from "./native-minio.js";

let minio: NativeMinio;

beforeAll(async () => {
  minio = await startNativeMinio();
});

afterAll(async () => {
  await minio?.stop();
});

describe("TC-D01-01 Presigned append-only upload", () => {
  test("uses a random owner-scoped key and returns immutable version/checksum metadata", async () => {
    const storage = new S3ObjectStorage({
      endpoint: minio.endpoint,
      region: "local",
      bucket: minio.bucket,
      accessKey: minio.accessKey,
      secretKey: minio.secretKey,
    });
    const body = Buffer.from("actual native MinIO upload");
    const checksumSha256 = createHash("sha256").update(body).digest("base64");
    const first = storage.createUploadSession({
      ownerId: "owner-a",
      contentType: "image/png",
      contentLength: body.length,
      checksumSha256,
    });
    const second = storage.createUploadSession({
      ownerId: "owner-a",
      contentType: "image/png",
      contentLength: body.length,
      checksumSha256,
    });

    expect(first.objectKey).not.toBe(second.objectKey);
    expect(first.objectKey).toMatch(/^attachments\/[a-f0-9]{32}\//u);
    const upload = await fetch(first.uploadUrl, {
      method: "PUT",
      headers: first.headers,
      body,
    });
    expect(upload.status).toBe(200);
    const metadata = await storage.inspectObject(first.objectKey);
    expect(metadata).toMatchObject({
      objectKey: first.objectKey,
      checksumSha256,
      contentType: "image/png",
      contentLength: body.length,
    });
    expect(metadata.objectVersion).toBeTruthy();
  });

  test("rejects content type, size, and malformed checksum before signing", () => {
    const storage = new S3ObjectStorage({
      endpoint: minio.endpoint,
      region: "local",
      bucket: minio.bucket,
      accessKey: minio.accessKey,
      secretKey: minio.secretKey,
      maximumUploadBytes: 10,
    });
    const validChecksum = Buffer.alloc(32).toString("base64");
    expect(() => storage.createUploadSession({
      ownerId: "owner-a",
      contentType: "application/pdf",
      contentLength: 1,
      checksumSha256: validChecksum,
    })).toThrow(/content type/u);
    expect(() => storage.createUploadSession({
      ownerId: "owner-a",
      contentType: "image/png",
      contentLength: 11,
      checksumSha256: validChecksum,
    })).toThrow(/content length/u);
    expect(() => storage.createUploadSession({
      ownerId: "owner-a",
      contentType: "image/png",
      contentLength: 1,
      checksumSha256: "not-a-checksum",
    })).toThrow(/checksum/u);
  });
});
