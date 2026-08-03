import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, test } from "vitest";

import { CandidateTokenSigner } from "../../domain/src/location/index.mjs";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.OTR_C03_DATABASE_URL;
const liveTest = databaseUrl ? test : test.skip;
const ownerA = `tc-c03-db-owner-a-${randomUUID()}`;
const ownerB = `tc-c03-db-owner-b-${randomUUID()}`;
const tripA = randomUUID();
const tripB = randomUUID();

async function psql(sql: string): Promise<string> {
  if (!databaseUrl) throw new Error("OTR_C03_DATABASE_URL is required");
  const { stdout } = await execFileAsync(
    process.env.PSQL_BIN || "psql",
    [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  return stdout.trim();
}

async function applyMigration(): Promise<void> {
  if (!databaseUrl) return;
  const managedSchema = Boolean(
    await psql("SELECT to_regclass('public.otr_schema_migration')"),
  );
  if (managedSchema) return;
  await execFileAsync(
    process.env.PSQL_BIN || "psql",
    [
      databaseUrl,
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      "packages/database/src/migrations/0005_location.sql",
    ],
    {
      cwd: new URL("../../..", import.meta.url),
      maxBuffer: 2 * 1024 * 1024,
    },
  );
}

function tripInsert(id: string, ownerId: string): string {
  return `INSERT INTO trip (
    id, owner_id, name, start_date, end_date, travelers,
    default_currency, timezone, map_profile
  ) VALUES (
    '${id}', '${ownerId}', 'C03 invariants', '2026-10-01', '2026-10-02',
    1, 'CNY', 'UTC', 'international_primary'
  )`;
}

describe("TC-C03-02 DB, signature and staging invariants", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    await applyMigration();
    await psql(`DELETE FROM trip WHERE id IN ('${tripA}', '${tripB}')`);
    await psql(`${tripInsert(tripA, ownerA)}; ${tripInsert(tripB, ownerB)}`);
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    await psql(`DELETE FROM trip WHERE id IN ('${tripA}', '${tripB}')`);
  });

  liveTest("PostGIS and state CHECK constraints reject invalid facts", async () => {
    await assert.rejects(
      psql(`INSERT INTO location (
        trip_id, owner_id, input_text, name, geocoding_status
      ) VALUES (
        '${tripA}', '${ownerA}', 'missing point', 'missing point', 'resolved'
      )`),
    );
    await assert.rejects(
      psql(`INSERT INTO location (
        trip_id, owner_id, input_text, name, geocoding_status, geom
      ) VALUES (
        '${tripA}', '${ownerA}', 'bad point', 'bad point', 'resolved',
        ST_SetSRID(ST_MakePoint(181, 31), 4326)
      )`),
    );
    await assert.rejects(
      psql(`INSERT INTO location (
        trip_id, owner_id, input_text, name
      ) VALUES (
        '${tripB}', '${ownerA}', 'cross owner', 'cross owner'
      )`),
    );
  });

  liveTest("staged import JSON remains isolated from formal Location rows", async () => {
    const before = Number(await psql(
      `SELECT count(*) FROM location WHERE trip_id = '${tripA}'`,
    ));
    await psql(`INSERT INTO import_location_staging (
      trip_id, owner_id, source_row_key, staged_location
    ) VALUES (
      '${tripA}',
      '${ownerA}',
      'sheet-1:row-2',
      '{"inputText":"外滩","point":{"longitude":121.49,"latitude":31.24,"crs":"WGS84"}}'
    )`);
    const after = Number(await psql(
      `SELECT count(*) FROM location WHERE trip_id = '${tripA}'`,
    ));
    assert.equal(after, before);
    await assert.rejects(
      psql(`INSERT INTO import_location_staging (
        trip_id, owner_id, source_row_key, staged_location
      ) VALUES (
        '${tripA}',
        '${ownerA}',
        'sheet-1:row-3',
        '{"inputText":"bad","point":{"longitude":999,"latitude":31,"crs":"WGS84"}}'
      )`),
    );
  });

  test("candidate tokens reject tampering, expiry and context substitution", () => {
    let now = 1000;
    const signer = new CandidateTokenSigner({
      secret: "tc-c03-database-signature-secret-32-bytes",
      clock: () => now,
      ttlMs: 100,
    });
    const context = {
      ownerId: ownerA,
      tripId: tripA,
      locationId: "location-a",
      locationVersion: 2,
    };
    const token = signer.sign({
      ...context,
      candidate: {
        label: "外滩",
        providerPlaceId: "fixture:bund",
        attribution: "fixture",
        point: { longitude: 121.49, latitude: 31.24, crs: "WGS84" },
      },
    });
    const [body, signature] = token.split(".");
    const tamperedBody = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
        locationVersion: 3,
      }),
    ).toString("base64url");
    assert.throws(
      () => signer.verify(`${tamperedBody}.${signature}`, context),
      /signature/u,
    );
    assert.throws(
      () => signer.verify(token, { ...context, tripId: tripB }),
      /belong|version/u,
    );
    now = 1101;
    assert.throws(() => signer.verify(token, context), /expired/u);
  });
});
