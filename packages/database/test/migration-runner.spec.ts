import { describe, expect, test } from "vitest";

import {
  discoverMigrations,
  minimumCompatibleSchemaVersion,
} from "../src/migration/index.js";

describe("REVIEW-P1-02 migration manifest", () => {
  test("discovers one ordered migration per version and expands psql includes", async () => {
    const migrations = await discoverMigrations();
    expect(migrations.map(({ version }) => version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
      21,
    ]);
    expect(migrations.at(-1)?.version).toBe(minimumCompatibleSchemaVersion);
    for (const migration of migrations) {
      expect(migration.checksum).toMatch(/^[0-9a-f]{64}$/u);
      expect(migration.sql).not.toMatch(/^\\ir\s/gmu);
      expect(migration.sql.trim().length).toBeGreaterThan(20);
    }
  });
});
