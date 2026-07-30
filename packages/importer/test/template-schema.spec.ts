import { describe, expect, test } from "vitest";

import {
  ALIAS_DICTIONARY_VERSION,
  STANDARD_COLUMNS,
  TEMPLATE_VERSION,
  canonicalColumn,
  generateStandardTemplate,
  inspectTemplate,
} from "../src/index.mjs";

describe("TC-E01-01 template columns and aliases", () => {
  test("keeps a versioned standard schema and required bilingual aliases", () => {
    expect(TEMPLATE_VERSION).toBe("1.0.0");
    expect(ALIAS_DICTIONARY_VERSION).toBe("1.0.0");
    expect(STANDARD_COLUMNS).toEqual([
      "Day", "Date", "DayOfWeek", "IsWorkday", "Place", "Time", "Target",
      "Desc", "Hotel", "Dining", "Duration", "Mode", "StartLocation",
      "EndLocation", "Cost", "Currency", "CostCategory", "Remark", "Address",
      "Latitude", "Longitude", "ImageURLs",
    ]);
    expect(canonicalColumn("目的地")).toBe("Place");
    expect(canonicalColumn("出行日期")).toBe("Date");
    expect(canonicalColumn("详情")).toBe("Desc");
    expect(canonicalColumn("交通方式")).toBe("Mode");
    expect(canonicalColumn("Lng")).toBe("Longitude");
    expect(canonicalColumn("Lat")).toBe("Latitude");
  });

  test("generates deterministic bytes that describe the same schema", () => {
    const first = generateStandardTemplate();
    const second = generateStandardTemplate();

    expect(first).toEqual(second);
    expect(inspectTemplate(first)).toMatchObject({
      templateVersion: "1.0.0",
      columns: STANDARD_COLUMNS,
    });
  });
});
