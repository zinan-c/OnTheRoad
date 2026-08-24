import { describe, expect, test } from "vitest";

import { discoverMigrations } from "../src/migration/index.js";

describe("trip activity tracking migration", () => {
  test("backfills the cursor field and installs child-resource activity triggers", async () => {
    const migration = (await discoverMigrations()).find(({ version }) => version === 27);
    expect(migration).toBeDefined();
    expect(migration?.sql).toContain("ADD COLUMN IF NOT EXISTS last_activity_at timestamptz");
    expect(migration?.sql).toContain("SET last_activity_at = COALESCE(last_activity_at, updated_at");
    expect(migration?.sql).toContain("CREATE OR REPLACE FUNCTION touch_trip_last_activity()");
    expect(migration?.sql).toContain("AFTER INSERT OR UPDATE OR DELETE");
    expect(migration?.sql).toContain("import_media_task");
  });
});
