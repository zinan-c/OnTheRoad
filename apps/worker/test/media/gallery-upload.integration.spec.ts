import { createHash } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

import { PostgresExecutor } from "@on-the-road/database/postgres";
import { S3ObjectStorage } from "@on-the-road/storage";
import { PostgresAttachmentRepository } from "../../../../apps/api/src/modules/attachments/postgres-repository.mjs";
import { AttachmentUploadService } from "../../../../apps/api/src/modules/attachments/upload-session.mjs";
import { AttachmentGalleryService } from "../../../../apps/api/src/modules/attachments/gallery.mjs";
import {
  startNativeMinio,
  type NativeMinio,
} from "../../../../packages/storage/test/native-minio.js";

const databaseUrl = process.env.OTR_D03_DATABASE_URL
  ?? process.env.OTR_M3_DATABASE_URL;
const liveTest = databaseUrl ? test : test.skip;
const ownerId = "m3-d03-gallery";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

let minio: NativeMinio;
let database: PostgresExecutor | undefined;
let repository: PostgresAttachmentRepository | undefined;

beforeAll(async () => {
  if (databaseUrl) minio = await startNativeMinio();
});

afterEach(async () => {
  if (database) {
    await database.query("DELETE FROM trip WHERE owner_id = $1", [ownerId]);
    await database.close();
    database = undefined;
  }
  await repository?.close();
  repository = undefined;
});

afterAll(async () => {
  await minio?.stop();
});

describe("D03 production upload/gallery evidence", () => {
  liveTest("persists two immutable uploads and gallery metadata through production repositories", async () => {
    database = new PostgresExecutor({ databaseUrl, role: "worker" });
    const { tripId, itemId } = await seedGalleryItem(database);
    expect((await database.query(
      `SELECT id FROM itinerary_item
       WHERE id = $1::uuid AND trip_id = $2::uuid AND owner_id = $3`,
      [itemId, tripId, ownerId],
    )).rowCount).toBe(1);
    const storage = new S3ObjectStorage({
      endpoint: minio.endpoint,
      region: "local",
      bucket: minio.bucket,
      accessKey: minio.accessKey,
      secretKey: minio.secretKey,
    });
    repository = new PostgresAttachmentRepository({ databaseUrl, storage });
    const queued: string[] = [];
    const upload = new AttachmentUploadService({
      storage,
      repository,
      queue: {
        async lpush(key: string, value: string) {
          expect(key).toBe("otr:media");
          queued.push(JSON.parse(value).attachmentId);
        },
      },
    });

    const first = await uploadImage(upload, storage, tripId, itemId);
    const second = await uploadImage(upload, storage, tripId, itemId);
    expect(queued).toEqual([first.id, second.id]);

    const gallery = new AttachmentGalleryService(repository);
    const initial = await gallery.list(ownerId, itemId);
    expect(initial.map(({ id }: { id: string }) => id)).toEqual([first.id, second.id]);
    const captioned = await gallery.update(ownerId, first.id, first.version, {
      caption: "抵达",
      isCover: true,
    });
    expect(captioned).toMatchObject({
      caption: "抵达",
      isCover: true,
      version: first.version + 1,
    });

    const versions = Object.fromEntries(
      (await gallery.list(ownerId, itemId)).map(
        ({ id, version }: { id: string; version: number }) => [id, version],
      ),
    );
    const reordered = await gallery.reorder(
      ownerId,
      itemId,
      versions,
      [second.id, first.id],
    );
    expect(reordered.map(({ id }: { id: string }) => id)).toEqual([second.id, first.id]);

    await gallery.remove(ownerId, second.id);
    await repository.close();
    repository = new PostgresAttachmentRepository({ databaseUrl, storage });
    await expect(repository.list(ownerId, itemId)).resolves.toMatchObject([
      { id: first.id, caption: "抵达", isCover: true },
    ]);
  });
});

async function uploadImage(
  upload: AttachmentUploadService,
  storage: S3ObjectStorage,
  tripId: string,
  itemId: string,
) {
  const checksumSha256 = createHash("sha256").update(PNG).digest("base64");
  const session = await upload.createSession({
    ownerId,
    tripId,
    itemId,
    contentType: "image/png",
    contentLength: PNG.byteLength,
    checksumSha256,
  });
  const response = await fetch(session.uploadUrl, {
    method: "PUT",
    headers: session.headers,
    body: PNG,
  });
  expect(response.status).toBe(200);
  const completed = await upload.complete({
    ownerId,
    attachmentId: session.attachmentId,
  });
  expect(completed).toMatchObject({
    id: session.attachmentId,
    status: "uploaded",
    checksumSha256,
  });
  const immutable = await storage.inspectObject(completed.objectKey);
  expect(immutable.objectVersion).toBe(completed.objectVersion);
  return completed;
}

async function seedGalleryItem(database: PostgresExecutor) {
  const tripId = "00000000-0000-4000-8000-000000000901";
  const itemId = "00000000-0000-4000-8000-000000000902";
  await database.query(
    `INSERT INTO trip (
       id, owner_id, name, start_date, end_date, default_currency, timezone
     ) VALUES ($1::uuid, $2, 'D03 gallery', '2026-09-01', '2026-09-01', 'CNY', 'Asia/Shanghai')`,
    [tripId, ownerId],
  );
  const dayId = (await database.query<{ id: string }>(
    "SELECT id FROM trip_day WHERE trip_id = $1::uuid",
    [tripId],
  )).rows[0]!.id;
  await database.query(
    `INSERT INTO itinerary_item (
       id, trip_id, owner_id, trip_day_id, item_type, time_kind,
       target, sort_order
     ) VALUES ($1::uuid, $2::uuid, $3, $4::uuid,
               'attraction', 'unscheduled', 'Gallery', 1024)`,
    [itemId, tripId, ownerId, dayId],
  );
  return { tripId, itemId };
}
