import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, test } from "vitest";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.OTR_E02_DATABASE_URL;
const liveTest = databaseUrl ? test : test.skip;
const ownerA = `tc-e02-owner-a-${randomUUID()}`;
const ownerB = `tc-e02-owner-b-${randomUUID()}`;
const attachmentId = randomUUID();
const checksum = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

describe("TC-E02 database attachment and inspect-job invariants", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    if ((await psql("SELECT to_regclass('public.attachment') IS NULL")) === "t") {
      await applyMigration("packages/database/src/migrations/0004_attachment.sql");
      await applyMigration("packages/database/src/migrations/0009_attachment_media.sql");
    }
    if (
      (await psql("SELECT to_regclass('public.import_inspect_job') IS NULL"))
      === "t"
    ) {
      await applyMigration("packages/database/src/migrations/0013_import_inspect.sql");
    }
    await cleanup();
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    await cleanup();
  });

  liveTest("composite owner FK rejects cross-owner jobs", async () => {
    await psql(pendingAttachment(attachmentId, ownerA, "trip.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
    await assert.rejects(psql(`INSERT INTO import_inspect_job (
      id, owner_id, attachment_id
    ) VALUES ('${randomUUID()}', '${ownerB}', '${attachmentId}')`));
  });

  liveTest("extension/MIME and clean-scan evidence constrain ready import sources", async () => {
    await assert.rejects(psql(pendingAttachment(
      randomUUID(),
      ownerA,
      "mismatch.xlsx",
      "text/csv",
    )));
    await assert.rejects(psql(readyAttachmentWithoutScan(randomUUID(), ownerA)));

    const uploadedId = randomUUID();
    await psql(uploadedAttachment(uploadedId, ownerA));
    await assert.rejects(psql(`SELECT mark_import_attachment_scan_clean(
      '${uploadedId}', 1, 'object-v1', '${checksum}', ''
    )`));
    await assert.rejects(psql(`SELECT mark_import_attachment_scan_clean(
      '${uploadedId}', 99, 'object-v1', '${checksum}', 'clamav'
    )`));
    const ready = JSON.parse(await psql(
      `SELECT mark_import_attachment_scan_clean(
        '${uploadedId}', 1, 'object-v1', '${checksum}', 'clamav'
      )::text`,
    ));
    assert.equal(ready.status, "ready");
    assert.equal(ready.scanEngine, "clamav");
  });

  liveTest("terminal jobs require a result or an explanatory permanent/retryable error", async () => {
    await psql(pendingAttachment(attachmentId, ownerA, "trip.csv", "text/csv"));
    await assert.rejects(psql(`INSERT INTO import_inspect_job (
      id, owner_id, attachment_id, status, attempts, completed_at
    ) VALUES (
      '${randomUUID()}', '${ownerA}', '${attachmentId}',
      'succeeded', 1, now()
    )`));
    await assert.rejects(psql(`INSERT INTO import_inspect_job (
      id, owner_id, attachment_id, status, attempts,
      error_code, error_message, completed_at
    ) VALUES (
      '${randomUUID()}', '${ownerA}', '${attachmentId}', 'failed', 1,
      'WORKBOOK_CORRUPT', 'corrupt', now()
    )`));
  });
});

async function psql(sql: string): Promise<string> {
  if (!databaseUrl) throw new Error("OTR_E02_DATABASE_URL is required");
  const { stdout } = await execFileAsync(
    process.env.PSQL_BIN || "psql",
    [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  return stdout.trim();
}

async function applyMigration(path: string): Promise<void> {
  if (!databaseUrl) return;
  await execFileAsync(
    process.env.PSQL_BIN || "psql",
    [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-f", path],
    {
      cwd: new URL("../../..", import.meta.url),
      maxBuffer: 2 * 1024 * 1024,
    },
  );
}

async function cleanup(): Promise<void> {
  await psql(`DELETE FROM import_inspect_job
    WHERE owner_id IN ('${ownerA}', '${ownerB}')`);
  await psql(`DELETE FROM attachment
    WHERE owner_id IN ('${ownerA}', '${ownerB}')`);
}

function pendingAttachment(
  id: string,
  ownerId: string,
  filename: string,
  contentType: string,
): string {
  return `INSERT INTO attachment (
    id, owner_id, object_key, expected_content_type,
    expected_content_length, expected_checksum_sha256, expires_at,
    purpose, source_filename
  ) VALUES (
    '${id}', '${ownerId}', 'attachments/${id.replaceAll("-", "")}/source',
    '${contentType}', 128, '${checksum}', now() + interval '1 hour',
    'import_source', '${filename}'
  ) ON CONFLICT (id) DO NOTHING`;
}

function uploadedAttachment(id: string, ownerId: string): string {
  return `INSERT INTO attachment (
    id, owner_id, object_key, expected_content_type,
    expected_content_length, expected_checksum_sha256, expires_at,
    purpose, source_filename, status, object_version, checksum_sha256,
    content_type, content_length, etag, completed_at
  ) VALUES (
    '${id}', '${ownerId}', 'attachments/${id.replaceAll("-", "")}/source',
    'text/csv', 128, '${checksum}', now() + interval '1 hour',
    'import_source', 'trip.csv', 'uploaded', 'object-v1', '${checksum}',
    'text/csv', 128, 'etag', now()
  )`;
}

function readyAttachmentWithoutScan(id: string, ownerId: string): string {
  return uploadedAttachment(id, ownerId)
    .replace("'uploaded'", "'ready'");
}
