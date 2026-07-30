import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  currencies,
  transportModes,
} from "@on-the-road/config/reference-data";

const execFileAsync = promisify(execFile);

export const itineraryDatabaseUrl =
  process.env.OTR_B07_DATABASE_URL
  || process.env.OTR_B05_DATABASE_URL
  || process.env.OTR_M1_DATABASE_URL
  || process.env.OTR_TRIP_DATABASE_URL;

export async function psql(sql, options = {}) {
  if (!itineraryDatabaseUrl) throw new Error("OTR_B05_DATABASE_URL is required");
  const { stdout } = await execFileAsync(
    process.env.PSQL_BIN || "psql",
    [
      itineraryDatabaseUrl,
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "-c",
      sql,
    ],
    { maxBuffer: 2 * 1024 * 1024, ...options },
  );
  return stdout.trim();
}

export async function applyMigration(file) {
  if (!itineraryDatabaseUrl) return;
  await execFileAsync(
    process.env.PSQL_BIN || "psql",
    [itineraryDatabaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-f", file],
    {
      cwd: new URL("../../../..", import.meta.url),
      maxBuffer: 2 * 1024 * 1024,
    },
  );
}

export async function prepareItineraryDatabase() {
  if (!itineraryDatabaseUrl) return;
  if (!(await psql("SELECT to_regclass('public.reference_currency')"))) {
    await applyMigration("packages/database/src/migrations/0002_reference_data.sql");
  }
  const currencyValues = currencies
    .map(({ code, label, aliases }) =>
      `('${code}', '${label.replaceAll("'", "''")}', '${JSON.stringify(aliases).replaceAll("'", "''")}'::jsonb)`)
    .join(",");
  await psql(
    `INSERT INTO reference_currency (code, label, aliases)
     VALUES ${currencyValues}
     ON CONFLICT (code) DO UPDATE
     SET label = EXCLUDED.label, aliases = EXCLUDED.aliases`,
  );
  const modeValues = transportModes
    .map(({ code, label, aliases, icon, color, lineStyle }) =>
      `('${code}', '${label.replaceAll("'", "''")}', '${JSON.stringify(aliases).replaceAll("'", "''")}'::jsonb, '${icon}', '${color}', '${lineStyle}')`)
    .join(",");
  await psql(
    `INSERT INTO reference_transport_mode (
       code, label, aliases, icon, color, line_style
     )
     VALUES ${modeValues}
     ON CONFLICT (code) DO UPDATE
     SET label = EXCLUDED.label,
         aliases = EXCLUDED.aliases,
         icon = EXCLUDED.icon,
         color = EXCLUDED.color,
         line_style = EXCLUDED.line_style`,
  );
  await applyMigration("packages/database/src/migrations/0003_trip.sql");
  await applyMigration("packages/database/src/migrations/0006_trip_day.sql");
  await applyMigration("packages/database/src/migrations/0005_location.sql");
  await applyMigration("packages/database/src/migrations/0007_itinerary.sql");
}

export async function cleanOwner(ownerId) {
  if (!itineraryDatabaseUrl) return;
  const encoded = Buffer.from(JSON.stringify([ownerId]), "utf8").toString("base64");
  await psql(
    `DELETE FROM trip
     WHERE owner_id = convert_from(decode('${encoded}', 'base64'), 'utf8')::jsonb->>0`,
  );
}
