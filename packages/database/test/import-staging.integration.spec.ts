import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, test } from "vitest";

import { mappingContractHash } from "@on-the-road/importer";
import { PostgresExecutor } from "../src/postgres/index.js";

const databaseUrl = process.env.OTR_E04_DATABASE_URL
  ?? process.env.OTR_M3_DATABASE_URL;
const liveTest = databaseUrl ? test : test.skip;
const ownerId = "m3-e04-invariants";
let database: PostgresExecutor | undefined;
const stagedJobIds: string[] = [];

afterEach(async () => {
  if (!database) return;
  await database.query(
    "DELETE FROM import_row WHERE import_job_id = ANY($1::uuid[])",
    [stagedJobIds],
  );
  await database.query("DELETE FROM trip WHERE owner_id = $1", [ownerId]);
  await database.close();
  database = undefined;
  stagedJobIds.length = 0;
});

describe("TC-E04-02 fingerprint/hash/ledger invariants", () => {
  liveTest("keeps canonical mapping hashes stable and rejects duplicate staging identities", async () => {
    database = new PostgresExecutor({ databaseUrl, role: "test" });
    const tripId = randomUUID();
    const firstJobId = randomUUID();
    const secondJobId = randomUUID();
    stagedJobIds.push(firstJobId, secondJobId);
    const firstRowId = randomUUID();
    const secondRowId = randomUUID();
    const mappingHash = mappingContractHash({ 事项: "Target", 天: "Day" });
    expect(mappingHash).toBe(mappingContractHash({ 天: "Day", 事项: "Target" }));

    await database.query(
      `INSERT INTO trip (
         id, owner_id, name, start_date, end_date, default_currency, timezone
       ) VALUES ($1::uuid, $2, 'E04 invariants',
                 '2026-09-01', '2026-09-01', 'CNY', 'Asia/Shanghai')`,
      [tripId, ownerId],
    );
    await database.query(
      `INSERT INTO import_row (
         id, import_job_id, sheet_name, row_number, source_row_key, raw_data
       ) VALUES ($1::uuid, $2::uuid, 'Sheet 1', 2, 'Sheet 1:2', '{}')`,
      [firstRowId, firstJobId],
    );
    await expect(database.query(
      `INSERT INTO import_row (
         import_job_id, sheet_name, row_number, source_row_key, raw_data
       ) VALUES ($1::uuid, 'Sheet 1', 3, 'Sheet 1:2', '{}')`,
      [firstJobId],
    )).rejects.toMatchObject({ code: "DATABASE_QUERY_FAILED" });

    const commonLedger = [
      tripId,
      ownerId,
      "a".repeat(64),
      "runtime-1",
      mappingHash,
      "Sheet 1:2",
      "b".repeat(64),
    ] as const;
    await database.query(
      `INSERT INTO import_commit_ledger (
         trip_id, owner_id, import_job_id, import_row_id,
         source_sha256, importer_version, mapping_hash,
         source_row_key, row_fingerprint, action
       ) VALUES (
         $1::uuid, $2, $3::uuid, $4::uuid,
         $5, $6, $7, $8, $9, 'skip'
       )`,
      [
        commonLedger[0], commonLedger[1], firstJobId, firstRowId,
        ...commonLedger.slice(2),
      ],
    );
    await expect(database.query(
      `INSERT INTO import_commit_ledger (
         trip_id, owner_id, import_job_id, import_row_id,
         source_sha256, importer_version, mapping_hash,
         source_row_key, row_fingerprint, action
       ) VALUES (
         $1::uuid, $2, $3::uuid, $4::uuid,
         $5, $6, $7, $8, $9, 'skip'
       )`,
      [
        commonLedger[0], commonLedger[1], secondJobId, secondRowId,
        ...commonLedger.slice(2),
      ],
    )).rejects.toMatchObject({ code: "DATABASE_QUERY_FAILED" });
  });
});
