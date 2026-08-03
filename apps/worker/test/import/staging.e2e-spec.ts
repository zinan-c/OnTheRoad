import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, test } from "vitest";

import { PostgresExecutor } from "@on-the-road/database/postgres";
import { PostgresImportStagingProcessor } from "../../src/processors/import/postgres-staging-processor.js";

const databaseUrl = process.env.OTR_E04_DATABASE_URL
  ?? process.env.OTR_M3_DATABASE_URL;
const liveTest = databaseUrl ? test : test.skip;
const ownerId = "m3-e04-staging";
let database: PostgresExecutor | undefined;
let processor: PostgresImportStagingProcessor | undefined;

afterEach(async () => {
  if (database) {
    await database.query("DELETE FROM trip WHERE owner_id = $1", [ownerId]);
    await database.close();
    database = undefined;
  }
  await processor?.close();
  processor = undefined;
});

describe("TC-E04-03 workbook-to-staging E2E", () => {
  liveTest("normalizes, validates, fingerprints, and stages without formal writes", async () => {
    database = new PostgresExecutor({ databaseUrl, role: "worker" });
    processor = new PostgresImportStagingProcessor(databaseUrl!);
    const { jobId, tripId } = await seedImport(database);
    const itineraryBefore = await countItinerary(database, tripId);

    await expect(processor.process(jobId)).resolves.toEqual({
      jobId,
      totalRows: 4,
      validRows: 2,
      errorRows: 1,
      duplicateRows: 1,
      unresolvedRows: 1,
    });

    const rows = (await database.query<{
      row_number: number;
      normalized_data: Record<string, unknown>;
      fingerprint: string;
      status: string;
      errors: Array<{ code: string }>;
    }>(
      `SELECT row_number, normalized_data, fingerprint, status, errors
       FROM import_row
       WHERE import_job_id = $1::uuid
       ORDER BY row_number`,
      [jobId],
    )).rows;
    expect(rows.map(({ status }) => status)).toEqual([
      "new",
      "duplicate",
      "error",
      "unresolved",
    ]);
    expect(rows[0]?.normalized_data).toMatchObject({
      day: 1,
      target: "外滩",
      cost: 12.5,
      currency: "CNY",
    });
    expect(rows[0]?.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(rows[1]?.fingerprint).toBe(rows[0]?.fingerprint);
    expect(rows[2]?.errors.map(({ code }) => code)).toContain("TARGET_REQUIRED");
    expect(rows[3]?.normalized_data).toMatchObject({ address: "人民广场" });
    expect(await countItinerary(database, tripId)).toBe(itineraryBefore);

    const job = (await database.query<{
      status: string;
      stage: string;
      total_rows: number;
      valid_rows: number;
      error_rows: number;
    }>(
      `SELECT status, stage, total_rows, valid_rows, error_rows
       FROM import_job WHERE id = $1::uuid`,
      [jobId],
    )).rows[0];
    expect(job).toMatchObject({
      status: "confirmation_required",
      stage: "confirmation_required",
      total_rows: 4,
      valid_rows: 2,
      error_rows: 1,
    });
  });
});

async function seedImport(database: PostgresExecutor) {
  const tripId = "00000000-0000-4000-8000-000000000801";
  const attachmentId = "00000000-0000-4000-8000-000000000802";
  const jobId = randomUUID();
  await database.query(
    `INSERT INTO trip (
       id, owner_id, name, start_date, end_date, default_currency, timezone
     ) VALUES ($1::uuid, $2, 'E04 staging', '2026-09-01', '2026-09-01', 'CNY', 'Asia/Shanghai')`,
    [tripId, ownerId],
  );
  await database.query(
    `INSERT INTO attachment (
       id, trip_id, owner_id, object_key, expected_content_type,
       expected_content_length, expected_checksum_sha256, expires_at,
       purpose, source_filename
     ) VALUES (
       $1::uuid, $2::uuid, $3,
       'attachments/00000000000000000000000000000000/e04-source',
       'text/csv', 1, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
       now() + interval '1 hour', 'import_source', 'source.csv'
     )`,
    [attachmentId, tripId, ownerId],
  );
  await database.query(
    `INSERT INTO import_job (
       id, trip_id, owner_id, source_attachment_id, source_sha256,
       importer_type, importer_version, mapping, mapping_hash,
       mapping_version, status, stage
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4::uuid,
       repeat('a', 64), 'csv', '1.0.0',
       '{"日":"Day","目标":"Target","费用":"Cost","币种":"Currency","地址":"Address"}'::jsonb,
       repeat('b', 64), 1, 'validating', 'validating'
     )`,
    [jobId, tripId, ownerId, attachmentId],
  );
  const rawRows = [
    { 日: "1", 目标: "外滩", 费用: "12.50", 币种: "CNY" },
    { 日: "1", 目标: "外滩", 费用: "12.50", 币种: "CNY" },
    { 日: "0" },
    { 日: "1", 目标: "人民广场", 地址: "人民广场" },
  ];
  for (const [index, raw] of rawRows.entries()) {
    await database.query(
      `INSERT INTO import_row (
         import_job_id, sheet_name, row_number, source_row_key, raw_data
       ) VALUES ($1::uuid, '旅程', $2, $3, $4::jsonb)`,
      [jobId, index + 2, `旅程:${index + 2}`, JSON.stringify(raw)],
    );
  }
  return { jobId, tripId };
}

async function countItinerary(database: PostgresExecutor, tripId: string) {
  return Number((await database.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM itinerary_item WHERE trip_id = $1::uuid",
    [tripId],
  )).rows[0]?.count ?? "0");
}
