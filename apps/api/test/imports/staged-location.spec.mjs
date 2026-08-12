import { describe, expect, test } from "vitest";

import { PostgresImportUnresolvedLocationService } from "../../src/modules/imports/unresolved.mjs";

const ownerId = "owner-1";
const jobId = "00000000-0000-4000-8000-000000000001";
const stagingId = "00000000-0000-4000-8000-000000000002";
const rowId = "00000000-0000-4000-8000-000000000003";
const tripId = "00000000-0000-4000-8000-000000000004";

function database() {
  const queries = [];
  const client = {
    async query(text) {
      queries.push(text);
      if (text.includes("SELECT s.id, s.trip_id, s.owner_id")) {
        return {
          rows: [{
            id: stagingId,
            trip_id: tripId,
            owner_id: ownerId,
            source_row_key: "Itinerary:1",
            staged_location: { inputText: "外滩" },
            status: "staged",
            version: 1,
            import_row_id: rowId,
            row_status: "unresolved",
          }],
        };
      }
      if (text.includes("SELECT COALESCE((")) return { rows: [{ version: 1 }] };
      return { rows: [] };
    },
  };
  return {
    queries,
    async transaction(operation) {
      return operation(client);
    },
  };
}

describe("E07 staged location decision", () => {
  test("moves the parent import job to ready_to_import after the last unresolved row", async () => {
    const db = database();
    const service = new PostgresImportUnresolvedLocationService({
      database: db,
      candidateSigner: { verify() { throw new Error("not used"); } },
    });

    await expect(service.decide(ownerId, jobId, stagingId, {
      type: "accept_text",
      name: "外滩",
    })).resolves.toMatchObject({ status: "ready" });

    const transition = db.queries.find((query) => query.includes("SET status = 'ready_to_import'"));
    expect(transition).toContain("NOT EXISTS");
    expect(transition).toContain("r.status = 'unresolved'");
  });
});
