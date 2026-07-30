import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  costCategories,
  currencies,
  transportModes,
} from "@on-the-road/config/reference-data";

const execFileAsync = promisify(execFile);

export const expenseDatabaseUrl = process.env.OTR_D04_DATABASE_URL;

export async function psql(sql) {
  if (!expenseDatabaseUrl) throw new Error("OTR_D04_DATABASE_URL is required");
  const { stdout } = await execFileAsync(
    process.env.PSQL_BIN || "psql",
    [
      expenseDatabaseUrl,
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "-c",
      sql,
    ],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  return stdout.trim();
}

export async function applyMigration(file) {
  if (!expenseDatabaseUrl) return;
  await execFileAsync(
    process.env.PSQL_BIN || "psql",
    [expenseDatabaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-f", file],
    {
      cwd: new URL("../../../..", import.meta.url),
      maxBuffer: 2 * 1024 * 1024,
    },
  );
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export async function prepareExpenseDatabase() {
  if (!expenseDatabaseUrl) return;
  if (!(await psql("SELECT to_regclass('public.reference_currency')"))) {
    await applyMigration("packages/database/src/migrations/0002_reference_data.sql");
  }
  await psql(
    `INSERT INTO reference_currency (code, label, aliases)
     VALUES ${currencies.map(({ code, label, aliases }) =>
       `(${quote(code)}, ${quote(label)}, ${quote(JSON.stringify(aliases))}::jsonb)`).join(",")}
     ON CONFLICT (code) DO NOTHING`,
  );
  await psql(
    `INSERT INTO reference_cost_category (code, label, icon, color)
     VALUES ${costCategories.map(({ code, label, icon, color }) =>
       `(${quote(code)}, ${quote(label)}, ${quote(icon)}, ${quote(color)})`).join(",")}
     ON CONFLICT (code) DO NOTHING`,
  );
  await psql(
    `INSERT INTO reference_transport_mode (
       code, label, aliases, icon, color, line_style
     )
     VALUES ${transportModes.map(({ code, label, aliases, icon, color, lineStyle }) =>
       `(${quote(code)}, ${quote(label)}, ${quote(JSON.stringify(aliases))}::jsonb, ${quote(icon)}, ${quote(color)}, ${quote(lineStyle)})`).join(",")}
     ON CONFLICT (code) DO NOTHING`,
  );
  await applyMigration("packages/database/src/migrations/0003_trip.sql");
  await applyMigration("packages/database/src/migrations/0006_trip_day.sql");
  await applyMigration("packages/database/src/migrations/0005_location.sql");
  await applyMigration("packages/database/src/migrations/0007_itinerary.sql");
  await applyMigration("packages/database/src/migrations/0011_expense.sql");
}

export async function cleanOwner(ownerId) {
  if (!expenseDatabaseUrl) return;
  await psql(`DELETE FROM trip WHERE owner_id = ${quote(ownerId)}`);
}
