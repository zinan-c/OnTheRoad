import { describe, expect, test } from "vitest";

import { discoverMigrations } from "../src/migration/index.js";

describe("trip lifecycle migration", () => {
  test("preserves the pre-trash status and exposes safe lifecycle transitions", async () => {
    const migration = (await discoverMigrations()).find(({ version }) => version === 28);
    expect(migration).toBeDefined();
    expect(migration?.sql).toContain("ADD COLUMN IF NOT EXISTS status_before_delete");
    expect(migration?.sql).toContain("SET status_before_delete = 'active'");
    expect(migration?.sql).toContain("trip_deleted_state_check");
    expect(migration?.sql).toContain("Re-apply trip transition functions");
    expect(migration?.sql).toContain("'draft', 'active', 'archived', 'deleted', 'restore'");
  });
});
