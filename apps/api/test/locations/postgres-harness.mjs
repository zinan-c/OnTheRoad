import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { test } from "vitest";

const execFileAsync = promisify(execFile);

export const locationDatabaseUrl = process.env.OTR_C03_DATABASE_URL;
export const liveLocationTest = locationDatabaseUrl ? test : test.skip;

export async function psql(sql) {
  if (!locationDatabaseUrl) throw new Error("OTR_C03_DATABASE_URL is required");
  const { stdout } = await execFileAsync(
    process.env.PSQL_BIN || "psql",
    [locationDatabaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  return stdout.trim();
}

export async function prepareLocationDatabase(ownerId) {
  if (!locationDatabaseUrl) return undefined;
  await execFileAsync(
    process.env.PSQL_BIN || "psql",
    [
      locationDatabaseUrl,
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      "packages/database/src/migrations/0005_location.sql",
    ],
    {
      cwd: new URL("../../../..", import.meta.url),
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  await execFileAsync(
    process.env.PSQL_BIN || "psql",
    [
      locationDatabaseUrl,
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      "packages/database/src/migrations/0012_location_coordinate_audit.sql",
    ],
    {
      cwd: new URL("../../../..", import.meta.url),
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  const tripId = randomUUID();
  await psql(`INSERT INTO trip (
    id, owner_id, name, start_date, end_date, travelers,
    default_currency, timezone, map_profile
  ) VALUES (
    '${tripId}', '${ownerId}', 'C03 API', '2026-10-01', '2026-10-03',
    1, 'CNY', 'UTC', 'international_primary'
  )`);
  return tripId;
}

export async function cleanTrip(tripId) {
  if (!tripId) return;
  await psql(`DELETE FROM trip WHERE id = '${tripId}'`);
}
