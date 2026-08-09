import { describe, expect, test } from "vitest";

import { canonicalizeMapping, suggestMappings, validateMapping } from "../src/index.mjs";

describe("TC-E03-01 mapping suggestion score", () => {
  test("scores Chinese/English aliases and explains the recommendation", () => {
    const result = suggestMappings({ sourceColumns: ["日期", "事项", "Latitude"], sampleRows: [{ 日期: "2026-08-01", 事项: "抵达", Latitude: "31.2" }] });
    expect(result.find(({ source }) => source === "日期")?.candidates[0]).toMatchObject({ target: "Date", score: 1 });
    expect(result.find(({ source }) => source === "事项")?.candidates[0]?.explanation).toContain("表头别名");
  });

  test("recognizes exported fixture Title and Location headers", () => {
    const result = suggestMappings({ sourceColumns: ["title", "location"] });
    expect(result.map(({ candidates }) => candidates[0]?.target)).toEqual(["Target", "Place"]);
  });

  test("detects duplicate, missing, unknown and multi-sheet mappings", () => {
    const result = validateMapping({ mapping: { 事项: "Target", 描述: "Target", Unknown: "Date" }, sourceColumns: ["事项", "描述"], sheetNames: ["Sheet 1", "Sheet 2"] });
    expect(result.valid).toBe(false);
    expect(result.issues.map(({ code }) => code)).toEqual(["SOURCE_COLUMN_UNKNOWN", "TARGET_DUPLICATE", "MULTI_SHEET_REVIEW_REQUIRED"]);
  });

  test("canonicalizes object key order for stable E04 hash", () => {
    expect(canonicalizeMapping({ 描述: "Desc", 事项: "Target" })).toEqual({ 描述: "Desc", 事项: "Target" });
    expect(validateMapping({ mapping: { 事项: "Target" }, sourceColumns: ["事项"] }).hash).toMatch(/^[0-9a-f]{64}$/u);
  });
});
