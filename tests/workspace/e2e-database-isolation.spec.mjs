import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const runnerUrl = new URL("../../scripts/run-e2e-environment.sh", import.meta.url);
const fingerprintUrl = new URL("../../scripts/database-row-count-fingerprint.sql", import.meta.url);

describe("product E2E ordinary database isolation", () => {
  test("captures every application table and checks the fingerprint during cleanup", async () => {
    const [runner, fingerprint] = await Promise.all([
      readFile(runnerUrl, "utf8"),
      readFile(fingerprintUrl, "utf8"),
    ]);

    expect(fingerprint).toContain("FROM pg_tables");
    expect(fingerprint).toContain("ORDER BY schemaname, tablename");
    expect(fingerprint).toContain("\\gexec");
    expect(runner).toContain('ORDINARY_DATABASE_FINGERPRINT="$(database_fingerprint "${DATABASE_URL}")"');
    expect(runner).toContain('ordinary_database_fingerprint_after="$(database_fingerprint "${DATABASE_URL}")"');
    expect(runner).toContain('"${ordinary_database_fingerprint_after}" != "${ORDINARY_DATABASE_FINGERPRINT}"');
    expect(runner).toContain('"${ordinary_database_name}" == "${E2E_DATABASE_NAME}"');
    expect(runner).toContain("Disposable product E2E database still exists after cleanup.");
    expect(runner).toContain("trap cleanup EXIT");
  });
});
