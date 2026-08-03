import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "vitest";

const execFileAsync = promisify(execFile);

export const attachmentDatabaseUrl = process.env.OTR_D01_DATABASE_URL;
export const liveAttachmentTest = attachmentDatabaseUrl ? test : test.skip;

export async function psql(sql) {
  if (!attachmentDatabaseUrl) {
    throw new Error("OTR_D01_DATABASE_URL is required");
  }
  const { stdout } = await execFileAsync(
    process.env.PSQL_BIN || "psql",
    [attachmentDatabaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  return stdout.trim();
}

export async function prepareAttachmentDatabase() {
  if (!attachmentDatabaseUrl) return;
  if (
    (await psql("SELECT to_regclass('public.attachment') IS NULL")) !== "t"
  ) {
    return;
  }
  await execFileAsync(
    process.env.PSQL_BIN || "psql",
    [
      attachmentDatabaseUrl,
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      "packages/database/src/migrations/0004_attachment.sql",
    ],
    {
      cwd: new URL("../../../..", import.meta.url),
      maxBuffer: 2 * 1024 * 1024,
    },
  );
}

export async function cleanOwner(ownerId) {
  const escaped = ownerId.replaceAll("'", "''");
  await psql(`DELETE FROM attachment WHERE owner_id = '${escaped}'`);
}
