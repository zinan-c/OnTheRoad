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

describe("TC-D01-02 Overwrite and expiry", () => {
  test("conditional write rejects overwrite and preserves the original object", async () => {
    const storage = new S3ObjectStorage({
      endpoint: minio.endpoint,
      region: "local",
      bucket: minio.bucket,
      accessKey: minio.accessKey,
      secretKey: minio.secretKey,
      keyFactory: () => "fixed-key",
    });
    const original = Buffer.from("original");
    const checksumSha256 = createHash("sha256").update(original).digest("base64");
    const session = storage.createUploadSession({
      ownerId: "owner-a",
      contentType: "image/png",
      contentLength: original.length,
      checksumSha256,
    });
    const first = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: session.headers,
      body: original,
    });
    expect(first.status).toBe(200);
    const originalMetadata = await storage.inspectObject(session.objectKey);

    const overwrite = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: session.headers,
      body: original,
    });
    expect(overwrite.status).toBe(412);
    expect(await storage.inspectObject(session.objectKey)).toEqual(originalMetadata);
  });

  test("native MinIO rejects an expired signed URL", async () => {
    const storage = new S3ObjectStorage({
      endpoint: minio.endpoint,
      region: "local",
      bucket: minio.bucket,
      accessKey: minio.accessKey,
      secretKey: minio.secretKey,
      clock: () => new Date(Date.now() - 120_000),
    });
    const body = Buffer.from("expired");
    const session = storage.createUploadSession({
      ownerId: "owner-a",
      contentType: "image/png",
      contentLength: body.length,
      checksumSha256: createHash("sha256").update(body).digest("base64"),
      expiresInSeconds: 1,
    });
    const response = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: session.headers,
      body,
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toMatch(/expired/u);
  });
});
