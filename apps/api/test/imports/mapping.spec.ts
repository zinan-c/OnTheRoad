import { describe, expect, test } from "vitest";

import { ImportMappingService, InMemoryImportMappingRepository } from "../../src/modules/imports/mapping.mjs";

describe("E03 mapping API contract", () => {
  test("saves canonical mapping and rejects stale edits", () => {
    const service = new ImportMappingService(new InMemoryImportMappingRepository());
    const first = service.save("owner", "job", { mapping: { 事项: "Target" }, sourceColumns: ["事项"] });
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(() => service.save("owner", "job", { mapping: { 事项: "Target" }, sourceColumns: ["事项"], expectedVersion: 0 })).toThrow("Mapping changed");
  });
});
