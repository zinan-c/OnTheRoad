import { describe, expect, test } from "vitest";

import { discoverMigrations, minimumCompatibleSchemaVersion } from "../src/migration/index.js";

describe("M4 Wave1 database foundation", () => {
  test("migration 0025 adds scoped replay, media task and worker lease boundaries", async () => {
    const migrations = await discoverMigrations();
    const migration = migrations.find(({ version }) => version === 25);
    expect(migration).toBeDefined();
    expect(minimumCompatibleSchemaVersion).toBe(27);
    expect(migration?.sql).toContain("CREATE TABLE IF NOT EXISTS import_media_task");
    expect(migration?.sql).toContain("import_commit_ledger_replay_uq");
    expect(migration?.sql).toContain("source_url_ciphertext");
    expect(migration?.sql).toContain("lease_token uuid");
    expect(migration?.sql).not.toMatch(/^\\ir\s/gmu);
  });
});
