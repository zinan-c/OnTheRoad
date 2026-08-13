import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, test } from "vitest";

import { PostgresExecutor } from "../../../packages/database/src/postgres/index.js";
import { PostgresImportStagingProcessor } from "../../../apps/worker/src/processors/import/postgres-staging-processor.js";

const databaseUrl = process.env.OTR_M3_DATABASE_URL;
const liveTest = databaseUrl ? test : test.skip;
const ownerId = "m3-int-import";
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

describe("TC-M3-INT-02 Import staging isolation", () => {
  liveTest("stages and pages 5,000 rows without formal Trip side effects", async () => {
    database = new PostgresExecutor({ databaseUrl, role: "test" });
    processor = new PostgresImportStagingProcessor(databaseUrl!);
    const context = await seedImport(database);
    const formalBefore = await formalCounts(database, context.tripId);

    const expectedResult = {
      jobId: context.jobId,
      totalRows: 5_000,
      validRows: 4_999,
      errorRows: 1,
      duplicateRows: 0,
      unresolvedRows: 0,
    };
    await expect(processor.process(context.jobId)).resolves.toEqual(expectedResult);
    expect(await stagedCounts(database, context.jobId)).toEqual({
      error: 1,
      new: 4_999,
    });
    const page = (await database.query<{
      source_row_key: string;
      status: string;
      normalized_data: Record<string, unknown>;
    }>(
      `SELECT source_row_key, status, normalized_data
       FROM import_row
       WHERE import_job_id = $1::uuid AND status = 'new'
       ORDER BY row_number
       LIMIT 50 OFFSET 4950`,
      [context.jobId],
    )).rows;
    expect(page).toHaveLength(49);
    expect(page[0]).toMatchObject({
      source_row_key: "Itinerary:4952",
      status: "new",
    });
    expect(page[0]?.normalized_data.target).toBe("Item 4951");
    expect(await formalCounts(database, context.tripId)).toEqual(formalBefore);

    await expect(processor.process(context.jobId)).resolves.toEqual(expectedResult);
    expect(await stagedCounts(database, context.jobId)).toEqual({
      error: 1,
      new: 4_999,
    });
    expect(await formalCounts(database, context.tripId)).toEqual(formalBefore);
  }, 60_000);
});

async function seedImport(db: PostgresExecutor) {
  const tripId = randomUUID();
  const locationId = randomUUID();
  const itemId = randomUUID();
  const attachmentId = randomUUID();
  const jobId = randomUUID();
  await db.query(
    `INSERT INTO trip (
       id, owner_id, name, start_date, end_date, default_currency, timezone
     ) VALUES (
       $1::uuid, $2, 'M3 import isolation',
       '2026-10-01', '2026-10-01', 'CNY', 'Asia/Shanghai'
     )`,
    [tripId, ownerId],
  );
  const dayId = (await db.query<{ id: string }>(
    "SELECT id FROM trip_day WHERE trip_id = $1::uuid",
    [tripId],
  )).rows[0]!.id;
  await db.query(
    `INSERT INTO location (
       id, trip_id, owner_id, input_text, name, geom,
       provider, source_crs, geocoding_status
     ) VALUES (
       $1::uuid, $2::uuid, $3, 'Formal item', 'Formal item',
       ST_SetSRID(ST_MakePoint(121.47, 31.23), 4326),
       'fixture', 'EPSG:4326', 'resolved'
     )`,
    [locationId, tripId, ownerId],
  );
  await db.query(
    `INSERT INTO itinerary_item (
       id, trip_id, owner_id, trip_day_id, item_type, time_kind,
       target, location_id, sort_order
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4::uuid, 'attraction', 'unscheduled',
       'Formal item', $5::uuid, 1024
     )`,
    [itemId, tripId, ownerId, dayId, locationId],
  );
  await db.query(
    `INSERT INTO attachment (
       id, trip_id, owner_id, object_key, expected_content_type,
       expected_content_length, expected_checksum_sha256, expires_at,
       purpose, source_filename
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4,
       'text/csv', 1, $5, now() + interval '1 hour',
       'import_source', 'm3.csv'
     )`,
    [
      attachmentId,
      tripId,
      ownerId,
      `attachments/${"b".repeat(32)}/${attachmentId.replaceAll("-", "")}`,
      `${"A".repeat(43)}=`,
    ],
  );
  await db.query(
    `INSERT INTO import_job (
       id, trip_id, owner_id, source_attachment_id, source_sha256,
       importer_type, importer_version, mapping, mapping_hash,
       mapping_version, status, stage
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4::uuid,
       repeat('a', 64), 'csv', '1.0.0',
       '{"Day":"Day","Target":"Target"}'::jsonb,
       repeat('b', 64), 1, 'validating', 'validating'
     )`,
    [jobId, tripId, ownerId, attachmentId],
  );
  await db.query(
    `INSERT INTO import_row (
       import_job_id, sheet_name, row_number, source_row_key, raw_data
     )
     SELECT $1::uuid, 'Itinerary', source.index + 1,
            'Itinerary:' || (source.index + 1),
            CASE WHEN source.index = 5000
              THEN '{"Day":"0"}'::jsonb
              ELSE jsonb_build_object(
                'Day', '1',
                'Target', 'Item ' || source.index
              )
            END
     FROM generate_series(1, 5000) AS source(index)`,
    [jobId],
  );
  return { tripId, jobId };
}

async function formalCounts(db: PostgresExecutor, tripId: string) {
  const row = (await db.query<{
    items: string;
    locations: string;
  }>(
    `SELECT
       (SELECT count(*)::text FROM itinerary_item WHERE trip_id = $1::uuid) AS items,
       (SELECT count(*)::text FROM location WHERE trip_id = $1::uuid) AS locations`,
    [tripId],
  )).rows[0]!;
  return {
    items: Number(row.items),
    locations: Number(row.locations),
  };
}

async function stagedCounts(db: PostgresExecutor, jobId: string) {
  return Object.fromEntries((await db.query<{
    status: string;
    count: string;
  }>(
    `SELECT status, count(*)::text AS count
     FROM import_row
     WHERE import_job_id = $1::uuid
     GROUP BY status
     ORDER BY status`,
    [jobId],
  )).rows.map(({ status, count }) => [status, Number(count)]));
}
