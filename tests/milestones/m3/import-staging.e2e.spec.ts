import { describe, expect, test } from "vitest";

import {
  mappingHash,
  normalizeImportRow,
  stableFingerprint,
  stableSourceRowKey,
  suggestMappings,
  validateNormalizedRow,
  validateMapping,
} from "../../../packages/importer/src/index.mjs";
import {
  buildPreviewCounts,
  filterPreviewRows,
  paginatePreviewRows,
  previewStageLabel,
  type PreviewRow,
} from "../../../apps/web/src/features/imports/preview/preview-model";
import { minimalFiveDay } from "../../../packages/test-fixtures/src/trips/minimal-five-day.mjs";

describe("TC-M3-INT-02 Import staging isolation", () => {
  test("maps, normalizes, validates and previews rows without changing formal fixtures", () => {
    const formalItemsBefore = structuredClone(minimalFiveDay.trip.days.flatMap(({ items }) => items));
    const formalLocationsBefore = structuredClone(minimalFiveDay.locations);
    const sourceColumns = ["日期", "事项", "费用", "币种", "交通方式", "纬度", "经度"];
    const sourceSamples = [{ 日期: "2026-10-01", 事项: "抵达上海", 费用: "80.00", 币种: "RMB", 交通方式: "地铁", 纬度: "31.23", 经度: "121.47" }];
    const suggestions = suggestMappings({ sourceColumns, sampleRows: sourceSamples });
    expect(suggestions.find(({ source }) => source === "事项")?.candidates[0]?.target).toBe("Target");

    const sourceToTarget = Object.fromEntries(suggestions.flatMap(({ source, candidates }) => {
      const target = candidates[0]?.target;
      return target ? [[source, target]] : [];
    }));
    const checkedMapping = validateMapping({ mapping: sourceToTarget, sourceColumns });
    expect(checkedMapping.valid).toBe(true);
    expect(mappingHash({ ...checkedMapping.mapping })).toBe(mappingHash({ ...checkedMapping.mapping }));

    const rawRows = [
      { 日期: "2026-10-01", 事项: "抵达上海", 费用: "80.00", 币种: "RMB", 交通方式: "地铁", 纬度: "31.23", 经度: "121.47" },
      { 日期: "2026-10-02", 事项: "未知费用", 费用: "-1", 币种: "XXX", 交通方式: "未知方式", 纬度: "91", 经度: "121.47" },
      { 日期: "2026-10-03", 事项: "待确认地点", 地址: "舟山某处" },
    ];
    const staged = rawRows.map((raw, index) => {
      const normalized = normalizeImportRow(raw, Object.fromEntries(Object.entries(checkedMapping.mapping).map(([source, target]) => [target, source])));
      const errors = validateNormalizedRow(normalized);
      return {
        sheetName: "Itinerary",
        rowNumber: index + 2,
        sourceRowKey: stableSourceRowKey("Itinerary", index + 2),
        rawData: raw,
        normalizedData: normalized,
        fingerprint: stableFingerprint(normalized),
        status: errors.length > 0 ? "error" : normalized.latitude === null ? "unresolved" : "new",
        errors,
      };
    });
    expect(staged[0]?.status).toBe("new");
    expect(staged[1]?.errors.map(({ field }) => field)).toEqual(expect.arrayContaining(["cost", "currency", "mode", "latitude"]));
    expect(staged[2]?.status).toBe("unresolved");
    expect(new Set(staged.map(({ sourceRowKey }) => sourceRowKey)).size).toBe(staged.length);

    const previewRows: PreviewRow[] = Array.from({ length: 5_000 }, (_, index) => ({
      id: `row-${index + 1}`,
      sheetName: "Itinerary",
      rowNumber: index + 2,
      sourceRowKey: `Itinerary:${index + 2}`,
      status: index === 1 ? "error" : "new",
      rawData: { Target: index === 1 ? "" : `事项 ${index + 1}` },
      normalizedData: {},
      errors: index === 1 ? [{ field: "target", message: "必填" }] : [],
    }));
    expect(buildPreviewCounts(previewRows)).toMatchObject({ total: 5_000, new: 4_999, error: 1 });
    expect(filterPreviewRows(previewRows, "error")).toHaveLength(1);
    expect(paginatePreviewRows(previewRows, 100, 50).items).toHaveLength(50);
    expect(previewStageLabel()).toContain("尚未写入");

    expect(minimalFiveDay.trip.days.flatMap(({ items }) => items)).toEqual(formalItemsBefore);
    expect(minimalFiveDay.locations).toEqual(formalLocationsBefore);
  });
});
