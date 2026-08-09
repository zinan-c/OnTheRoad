import { describe, expect, test } from "vitest";

import { ImportMappingService, InMemoryImportMappingRepository } from "../../src/modules/imports/mapping.mjs";

describe("E03 mapping API contract", () => {
  test("saves canonical mapping and rejects stale edits", async () => {
    const service = new ImportMappingService(new InMemoryImportMappingRepository());
    const first = await service.save("owner", "job", { mapping: { 事项: "Target" }, sourceColumns: ["事项"] });
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/u);
    await expect(service.save("owner", "job", {
      mapping: { 事项: "Target" },
      sourceColumns: ["事项"],
      expectedVersion: 0,
    })).rejects.toThrow("Mapping changed");
  });

  test("derives editable suggestions from inspected server rows", async () => {
    const service = new ImportMappingService({
      find: () => ({
        jobId: "job",
        ownerId: "owner",
        mapping: {},
        sourceColumns: ["Target", "日期", "费用"],
        sheetNames: ["Itinerary"],
        sampleRows: [{ Target: "Museum", 日期: "2026-08-01", 费用: "80" }],
      }),
    });
    const result = await service.get("owner", "job");
    expect(result.suggestions.map(({ source, candidates }) => [source, candidates[0]?.target])).toEqual([
      ["Target", "Target"],
      ["日期", "Date"],
      ["费用", "Cost"],
    ]);
  });
});
