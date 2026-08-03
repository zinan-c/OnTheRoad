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
});
