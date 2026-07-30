import { XLSX } from "./vendor/sheetjs-adapter.mjs";

import {
  ALIAS_DICTIONARY_VERSION,
  COLUMN_ALIASES,
  STANDARD_COLUMNS,
  safeSpreadsheetText,
} from "./aliases.mjs";

export const TEMPLATE_VERSION = "1.0.0";

const EXAMPLE_ROW = Object.freeze({
  Day: 1,
  Date: "2026-10-01",
  DayOfWeek: "Thursday",
  IsWorkday: "false",
  Place: "Shanghai",
  Time: "09:00",
  Target: "Shanghai Disneyland",
  Desc: "Select a candidate before import",
  Hotel: "",
  Dining: "",
  Duration: "PT4H",
  Mode: "TRANSIT",
  StartLocation: "",
  EndLocation: "",
  Cost: "499.00",
  Currency: "CNY",
  CostCategory: "TICKET",
  Remark: "Example only",
  Address: "Shanghai, China",
  Latitude: "31.1434",
  Longitude: "121.6578",
  ImageURLs: "",
});

/** @param {Array<readonly unknown[]>} values */
function textMatrix(values) {
  return values.map((row) => row.map((value) =>
    typeof value === "string" ? safeSpreadsheetText(value) : value));
}

export function generateStandardTemplate() {
  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: `On The Road Import Template v${TEMPLATE_VERSION}`,
    Subject: "Versioned standard itinerary import schema",
    Author: "On The Road",
    CreatedDate: new Date("2000-01-01T00:00:00.000Z"),
    ModifiedDate: new Date("2000-01-01T00:00:00.000Z"),
  };

  const itinerary = XLSX.utils.aoa_to_sheet(textMatrix([
    STANDARD_COLUMNS,
    STANDARD_COLUMNS.map((column) =>
      /** @type {Record<string, unknown>} */ (EXAMPLE_ROW)[column]),
  ]));
  itinerary["!cols"] = STANDARD_COLUMNS.map((column) => ({
    wch: Math.max(12, column.length + 2),
  }));
  XLSX.utils.book_append_sheet(workbook, itinerary, "Itinerary");

  const instructions = XLSX.utils.aoa_to_sheet(textMatrix([
    ["TemplateVersion", TEMPLATE_VERSION],
    ["AliasDictionaryVersion", ALIAS_DICTIONARY_VERSION],
    ["Rule", "Keep the Itinerary header row. Dates use YYYY-MM-DD."],
    ["Rule", "Currency RMB is accepted and normalized to CNY."],
    ["Rule", "Formula-like text is escaped and formulas are never executed."],
    ["Rule", "Mode, Currency, and CostCategory use configured codes."],
  ]));
  XLSX.utils.book_append_sheet(workbook, instructions, "Instructions");

  const aliases = XLSX.utils.aoa_to_sheet(textMatrix([
    ["CanonicalColumn", "AcceptedAliases"],
    ...STANDARD_COLUMNS.map((column) => [
      column,
      (COLUMN_ALIASES[column] ?? []).join(" | "),
    ]),
  ]));
  XLSX.utils.book_append_sheet(workbook, aliases, "Aliases");

  return XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    bookSST: true,
    compression: true,
    cellDates: false,
  });
}

/** @param {Buffer | Uint8Array} buffer */
export function inspectTemplate(buffer) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    raw: true,
    cellDates: false,
    cellFormula: false,
    bookVBA: true,
    dense: false,
  });
  if (workbook.vbaraw) {
    throw new Error("Macro-enabled templates are not supported.");
  }
  const itinerary = workbook.Sheets.Itinerary;
  if (!itinerary) throw new Error("Itinerary sheet is required.");
  const rows = XLSX.utils.sheet_to_json(itinerary, {
    header: 1,
    raw: true,
    blankrows: false,
  });
  const instructions = workbook.Sheets.Instructions;
  const instructionRows = instructions
    ? XLSX.utils.sheet_to_json(instructions, { header: 1, raw: true })
    : [];
  const templateVersionRow = instructionRows.find(
    (/** @type {unknown[]} */ row) => row[0] === "TemplateVersion",
  );
  return {
    templateVersion: templateVersionRow?.[1],
    columns: rows[0] ?? [],
    instructionsSheet: Boolean(instructions),
    aliasesSheet: Boolean(workbook.Sheets.Aliases),
  };
}
