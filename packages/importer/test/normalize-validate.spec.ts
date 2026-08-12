import { describe, expect, test } from "vitest";

import {
  mappingHash,
  normalizeImportRow,
  stableFingerprint,
  stableSourceRowKey,
  validateNormalizedRow,
} from "../src/index.mjs";

describe("TC-E04-01 normalize/validate golden", () => {
  test("normalizes aliases and produces deterministic fingerprints", () => {
    const row = normalizeImportRow({
      目的地: "上海博物馆",
      事项: "参观",
      费用: "1,280.50",
      币种: "RMB",
      交通方式: "地铁",
      纬度: "31.2304",
      经度: "121.4737",
    });

    expect(row).toMatchObject({ target: "参观", cost: 1280.5, currency: "CNY", mode: "METRO", latitude: 31.2304, longitude: 121.4737 });
    expect(validateNormalizedRow(row)).toEqual([]);
    expect(stableFingerprint(row)).toBe(stableFingerprint({ ...row }));
  });

  test("returns explicit issues without performing network work", () => {
    const row = normalizeImportRow({ Target: "", Cost: "10", ImageURLs: "ftp://example.test/a.jpg", Latitude: "91" });
    expect(validateNormalizedRow(row).map(({ code }) => code)).toEqual([
      "TARGET_REQUIRED",
      "CURRENCY_REQUIRED",
      "LATITUDE_INVALID",
      "COORDINATES_INCOMPLETE",
      "IMAGE_URL_INVALID",
    ]);
  });

  test("keeps mapping and source row identity stable", () => {
    expect(mappingHash({ Target: "事项", Day: "天" })).toBe(mappingHash({ Day: "天", Target: "事项" }));
    expect(stableSourceRowKey("Sheet 1", 7)).toBe("Sheet 1:7");
  });

  test("normalizes stable external identity for update classification", () => {
    expect(normalizeImportRow({ ExternalSource: "partner", ExternalId: "item-7", Target: "更新" }))
      .toMatchObject({ externalSource: "partner", externalId: "item-7" });
  });
});
