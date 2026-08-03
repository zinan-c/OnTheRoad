import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { currencies } from "../../../packages/config/src/reference-data.mjs";

const execFileAsync = promisify(execFile);

export const databaseUrl =
  process.env.OTR_M1_DATABASE_URL || process.env.OTR_TRIP_DATABASE_URL;
export const redisUrl =
  process.env.OTR_M1_REDIS_URL || process.env.REDIS_URL;

export async function psql(sql) {
  if (!databaseUrl) throw new Error("OTR_M1_DATABASE_URL is required");
  const { stdout } = await execFileAsync(
    process.env.PSQL_BIN || "psql",
    [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  return stdout.trim();
}

export async function applyMigration(file) {
  if (!databaseUrl) return;
  await execFileAsync(
    process.env.PSQL_BIN || "psql",
    [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-f", file],
    {
      cwd: new URL("../../..", import.meta.url),
      maxBuffer: 2 * 1024 * 1024,
    },
  );
}

export async function prepareTripDatabase() {
  if (!databaseUrl) return;
  const managedSchema = Boolean(
    await psql("SELECT to_regclass('public.otr_schema_migration')"),
  );
  if (!(await psql("SELECT to_regclass('public.reference_currency')"))) {
    await applyMigration("packages/database/src/migrations/0002_reference_data.sql");
  }
  const values = currencies
    .map(({ code, label, aliases }) =>
      `('${code}', '${label.replaceAll("'", "''")}', '${JSON.stringify(aliases).replaceAll("'", "''")}'::jsonb)`)
    .join(",");
  await psql(`
    INSERT INTO reference_currency (code, label, aliases)
    VALUES ${values}
    ON CONFLICT (code) DO UPDATE
    SET label = EXCLUDED.label, aliases = EXCLUDED.aliases
  `);
  if (!managedSchema) {
    await applyMigration("packages/database/src/migrations/0003_trip.sql");
    await applyMigration("packages/database/src/migrations/0006_trip_day.sql");
  }
}

export async function prepareJobsDatabase() {
  if (!databaseUrl) return;
  if (!(await psql("SELECT to_regclass('public.job_outbox')"))) {
    await applyMigration("packages/database/src/migrations/0001_jobs.sql");
  }
}

export function sqlText(value) {
  const encoded = Buffer.from(JSON.stringify([value]), "utf8").toString("base64");
  return `convert_from(decode('${encoded}', 'base64'), 'utf8')::jsonb->>0`;
}
