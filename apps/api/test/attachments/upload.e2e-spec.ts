import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  AttachmentUploadService,
  PostgresAttachmentRepository,
} from "../../src/modules/attachments/index.mjs";
import { S3ObjectStorage } from "@on-the-road/storage";
import {
  startNativeMinio,
  type NativeMinio,
} from "../../../../packages/storage/test/native-minio.js";
import {
  attachmentDatabaseUrl,
  cleanOwner,
  liveAttachmentTest,
  prepareAttachmentDatabase,
} from "./postgres-harness.mjs";

let minio: NativeMinio;
const ownerA = "tc-d01-owner-a";
const ownerB = "tc-d01-owner-b";

beforeAll(async () => {
  if (!attachmentDatabaseUrl) return;
  await prepareAttachmentDatabase();
  await cleanOwner(ownerA);
  await cleanOwner(ownerB);
  minio = await startNativeMinio();
});

afterAll(async () => {
  await minio?.stop();
  if (!attachmentDatabaseUrl) return;
  await cleanOwner(ownerA);
  await cleanOwner(ownerB);
});

function createService() {
  const storage = new S3ObjectStorage({
    endpoint: minio.endpoint,
    region: "local",
    bucket: minio.bucket,
    accessKey: minio.accessKey,
    secretKey: minio.secretKey,
  });
  return {
    storage,
    service: new AttachmentUploadService({
      storage,
      repository: new PostgresAttachmentRepository({
        databaseUrl: attachmentDatabaseUrl,
      }),
    }),
  };
}

describe("TC-D01-03 Native MinIO attachment round-trip", () => {
  liveAttachmentTest("browser-style direct upload completes and reloads matching immutable metadata", async () => {
    const { service, storage } = createService();
    const body = Buffer.from("attachment bytes through real MinIO");
    const checksumSha256 = createHash("sha256").update(body).digest("base64");
    const session = await service.createSession({
      ownerId: ownerA,
      contentType: "image/png",
      contentLength: body.length,
      checksumSha256,
    });
    const upload = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: session.headers,
      body,
    });
    expect(upload.status).toBe(200);

    const completed = await service.complete({
      ownerId: ownerA,
      attachmentId: session.attachmentId,
    });
    const reloaded = await service.get({
      ownerId: ownerA,
      attachmentId: session.attachmentId,
    });
    const actualObject = await storage.inspectObject(session.objectKey);
    expect(reloaded).toEqual(completed);
    expect(reloaded).toMatchObject({
      status: "uploaded",
      objectKey: actualObject.objectKey,
      objectVersion: actualObject.objectVersion,
      checksumSha256: actualObject.checksumSha256,
      contentLength: actualObject.contentLength,
    });
  });

  liveAttachmentTest("owner isolation and duplicate complete fail without disclosing metadata", async () => {
    const { service } = createService();
    const body = Buffer.from("owner isolation");
    const session = await service.createSession({
      ownerId: ownerA,
      contentType: "image/png",
      contentLength: body.length,
      checksumSha256: createHash("sha256").update(body).digest("base64"),
    });
    await expect(service.complete({
      ownerId: ownerB,
      attachmentId: session.attachmentId,
    })).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND", status: 404 });
    const upload = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: session.headers,
      body,
    });
    expect(upload.status).toBe(200);
    await service.complete({
      ownerId: ownerA,
      attachmentId: session.attachmentId,
    });
    await expect(service.complete({
      ownerId: ownerA,
      attachmentId: session.attachmentId,
    })).rejects.toMatchObject({ code: "UPLOAD_ALREADY_COMPLETED", status: 409 });
  });
});
