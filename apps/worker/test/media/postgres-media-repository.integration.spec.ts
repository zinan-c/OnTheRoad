import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { beforeAll, describe, expect, test } from "vitest";

import { PostgresMediaRepository } from "../../src/processors/media/postgres-media-repository.mjs";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.OTR_D02_DATABASE_URL;
const liveTest = databaseUrl ? test : test.skip;
const ownerId = "tc-d02-postgres-owner";

async function psql(sql: string): Promise<string> {
  if (!databaseUrl) throw new Error("OTR_D02_DATABASE_URL is required");
  const { stdout } = await execFileAsync(
    process.env.PSQL_BIN ?? "psql",
    [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  return stdout.trim();
}

beforeAll(async () => {
  if (!databaseUrl) return;
  await execFileAsync(
    process.env.PSQL_BIN ?? "psql",
    [
      databaseUrl,
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      "packages/database/src/migrations/0004_attachment.sql",
      "-f",
      "packages/database/src/migrations/0009_attachment_media.sql",
    ],
    {
      cwd: new URL("../../../..", import.meta.url),
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  await psql(`DELETE FROM attachment WHERE owner_id = '${ownerId}'`);
});

async function insertUploaded(id: string): Promise<void> {
  const checksum = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  await psql(`
    SELECT create_attachment(jsonb_build_object(
      'id', '${id}',
      'ownerId', '${ownerId}',
      'objectKey', 'attachments/00000000000000000000000000000000/${id}',
      'expectedContentType', 'image/png',
      'expectedContentLength', 68,
      'expectedChecksumSha256', '${checksum}',
      'expiresAt', to_char(clock_timestamp() + interval '5 minutes', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ));
    SELECT complete_attachment(
      '${ownerId}',
      '${id}',
      1,
      jsonb_build_object(
        'ownerId', '${ownerId}',
        'objectKey', 'attachments/00000000000000000000000000000000/${id}',
        'objectVersion', 'immutable-${id}',
        'checksumSha256', '${checksum}',
        'contentType', 'image/png',
        'contentLength', 68,
        'etag', '"etag-${id}"'
      )
    );
  `);
}

describe("D02 PostgreSQL attachment state invariants", () => {
  liveTest("persists immutable ready metadata under a CAS version", async () => {
    const id = "00000000-0000-4000-8000-000000000211";
    await insertUploaded(id);
    const repository = new PostgresMediaRepository({ databaseUrl });

    const processing = await repository.claim(id);
    const ready = await repository.markReady(id, processing.version, {
      width: 1,
      height: 1,
      thumbnailKey: `derived/${id}/00000000-0000-4000-8000-000000000212`,
      thumbnailVersion: "thumbnail-version",
      thumbnailChecksumSha256:
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      thumbnailContentType: "image/png",
      thumbnailContentLength: 68,
    });

    expect(ready).toMatchObject({
      status: "ready",
      objectVersion: `immutable-${id}`,
      width: 1,
      height: 1,
      processingErrorCode: null,
    });
    await expect(
      repository.markFailed(id, processing.version, "MEDIA_LATE_FAILURE"),
    ).rejects.toMatchObject({ code: "MEDIA_VERSION_CONFLICT" });
  });

  liveTest("records a fail-closed processing code without derivative metadata", async () => {
    const id = "00000000-0000-4000-8000-000000000213";
    await insertUploaded(id);
    const repository = new PostgresMediaRepository({ databaseUrl });

    const processing = await repository.claim(id);
    await expect(
      repository.markFailed(
        id,
        processing.version,
        "MEDIA_MALWARE_DETECTED",
      ),
    ).resolves.toMatchObject({
      status: "failed",
      processingErrorCode: "MEDIA_MALWARE_DETECTED",
      thumbnailKey: null,
    });
  });
});
