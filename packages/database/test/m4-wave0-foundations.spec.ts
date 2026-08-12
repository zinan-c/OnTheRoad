import { describe, expect, test } from "vitest";

import { discoverMigrations } from "../src/migration/index.js";

describe("M4 Wave0 database foundation", () => {
  test("migration 0024 expands the shared import/export foundations", async () => {
    const migration = (await discoverMigrations()).find(({ version }) => version === 24);
    expect(migration).toBeDefined();
    expect(migration?.sql).toContain("CREATE TABLE IF NOT EXISTS geocoding_batch");
    expect(migration?.sql).toContain("CREATE TABLE IF NOT EXISTS staged_location_decision");
    expect(migration?.sql).toContain("CREATE TABLE IF NOT EXISTS export_job");
    expect(migration?.sql).toContain("CREATE TABLE IF NOT EXISTS export_job_asset");
    expect(migration?.sql).toContain("ADD COLUMN IF NOT EXISTS batch_id uuid");
    expect(migration?.sql).toContain("FOREIGN KEY (batch_id, trip_id)");
    expect(migration?.sql).toContain("status NOT IN ('missing', 'failed', 'excluded')");
    expect(migration?.sql).not.toMatch(/^\\ir\\s/gmu);
  });
});
