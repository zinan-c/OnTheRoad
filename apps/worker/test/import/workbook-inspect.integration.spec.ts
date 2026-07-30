import { describe, expect, test } from "vitest";
import * as XLSX from "../../../../packages/importer/vendor/xlsx/xlsx.mjs";

import { inspectWorkbook } from "../../../../packages/importer/src/workbook-inspector.mjs";

describe("TC-E02-01 workbook inspection", () => {
  test("inspects xlsx with multiple sheets and returns columns plus bounded samples", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Day", "Target", "Cost"],
      [1, "外滩", 0],
      [2, "普陀山", 120],
    ]), "行程");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Code", "Label"],
      ["METRO", "地铁"],
    ]), "交通方式");

    const result = inspectWorkbook(Buffer.from(XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
      compression: true,
    })), { filename: "trip.xlsx", sampleRows: 1 });

    expect(result.format).toBe("xlsx");
    expect(result.sheets).toEqual([
      {
        name: "行程",
        columns: ["Day", "Target", "Cost"],
        samples: [{ Day: 1, Target: "外滩", Cost: 0 }],
        rowCount: 2,
      },
      {
        name: "交通方式",
        columns: ["Code", "Label"],
        samples: [{ Code: "METRO", Label: "地铁" }],
        rowCount: 1,
      },
    ]);
  });

  test.each([
    ["legacy.xls", "xls" as const],
    ["bom.csv", "csv" as const],
  ])("inspects %s without normalizing or writing staging", (filename, format) => {
    const body = format === "csv"
      ? Buffer.from("\uFEFFDay,Target,Remark\r\n1,Shanghai,hello\r\n", "utf8")
      : legacyWorkbook();
    const result = inspectWorkbook(body, { filename });

    expect(result.format).toBe(format);
    expect(result.sheets[0]).toMatchObject({
      columns: ["Day", "Target", "Remark"],
      samples: [{
        Day: format === "csv" ? "1" : 1,
        Target: "Shanghai",
        Remark: "hello",
      }],
      rowCount: 1,
    });
    expect(result).not.toHaveProperty("normalizedRows");
    expect(result).not.toHaveProperty("staging");
  });
});

function legacyWorkbook(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Day", "Target", "Remark"],
    [1, "Shanghai", "hello"],
  ]), "Sheet1");
  return Buffer.from(XLSX.write(workbook, {
    type: "buffer",
    bookType: "xls",
  }));
}
