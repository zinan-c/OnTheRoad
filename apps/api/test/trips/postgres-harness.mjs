import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "vitest";

import { currencies } from "@on-the-road/config/reference-data";

const execFileAsync = promisify(execFile);

export const tripDatabaseUrl = process.env.OTR_TRIP_DATABASE_URL;
export const liveTripTest = tripDatabaseUrl ? test : test.skip;

export async function psql(sql, options = {}) {
  if (!tripDatabaseUrl) throw new Error("OTR_TRIP_DATABASE_URL is required");
  const { stdout } = await execFileAsync(
    process.env.PSQL_BIN || "psql",
    [tripDatabaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    { maxBuffer: 2 * 1024 * 1024, ...options },
  );
  return stdout.trim();
}

export async function prepareTripDatabase() {
  if (!tripDatabaseUrl) return;
  const managedSchema = Boolean(
    await psql("SELECT to_regclass('public.otr_schema_migration')"),
  );
  const referenceTable = await psql("SELECT to_regclass('public.reference_currency')");
  if (!referenceTable) {
    await execFileAsync(
      process.env.PSQL_BIN || "psql",
      [
        tripDatabaseUrl,
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        "packages/database/src/migrations/0002_reference_data.sql",
      ],
      { cwd: new URL("../../../..", import.meta.url), maxBuffer: 2 * 1024 * 1024 },
    );
  }
  const values = currencies
    .map(({ code, label, aliases }) =>
      `('${code}', '${label.replaceAll("'", "''")}', '${JSON.stringify(aliases).replaceAll("'", "''")}'::jsonb)`)
    .join(",");
  await psql(
    `INSERT INTO reference_currency (code, label, aliases)
     VALUES ${values}
     ON CONFLICT (code) DO UPDATE
     SET label = EXCLUDED.label, aliases = EXCLUDED.aliases`,
  );
  if (!managedSchema) {
    await execFileAsync(
      process.env.PSQL_BIN || "psql",
      [
        tripDatabaseUrl,
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        "packages/database/src/migrations/0003_trip.sql",
      ],
      { cwd: new URL("../../../..", import.meta.url), maxBuffer: 2 * 1024 * 1024 },
    );
  }
}

export async function cleanOwner(ownerId) {
  const escaped = ownerId.replaceAll("'", "''");
  await psql(`DELETE FROM trip WHERE owner_id = '${escaped}'`);
}
