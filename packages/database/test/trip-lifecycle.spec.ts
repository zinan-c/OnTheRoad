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

  test("adds explicit creation states, a transition matrix, and accurate audit actions", async () => {
    const migration = (await discoverMigrations()).find(({ version }) => version === 29);
    expect(migration).toBeDefined();
    expect(migration?.sql).toContain("COALESCE(p_input->>'status', 'active')");
    expect(migration?.sql).toContain("current_trip.status = 'draft' AND resolved_target_status = 'active'");
    expect(migration?.sql).toContain("current_trip.status = 'active' AND resolved_target_status = 'archived'");
    expect(migration?.sql).toContain("current_trip.status = 'archived' AND resolved_target_status = 'active'");
    expect(migration?.sql).toContain("WHEN p_target_status = 'restore' THEN 'trip.restored'");
    expect(migration?.sql).toContain("ELSE 'trip.updated'");
    expect(migration?.sql).not.toContain("\\ir");
  });
});
