import { inflateRawSync } from "node:zlib";

import * as XLSX from "../../../packages/importer/vendor/xlsx/xlsx.mjs";
import * as cptable from "../../../packages/importer/vendor/xlsx/dist/cpexcel.full.mjs";

XLSX.set_cptable(cptable);

const DEFAULT_LIMITS = Object.freeze({
  maxCompressedBytes: 20 * 1024 * 1024,
  maxUncompressedBytes: 64 * 1024 * 1024,
  maxSharedStringsBytes: 8 * 1024 * 1024,
  maxEntries: 256,
  maxRows: 5_000,
  maxColumns: 128,
  maxCellCharacters: 32_768,
  maxCompressionRatio: 100,
});

export class ImportSecurityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ImportSecurityError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ImportSecurityError(code, message, details);
}

function mergeLimits(overrides) {
  return { ...DEFAULT_LIMITS, ...(overrides ?? {}) };
}

function guardXml(xml) {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) fail("IMPORT_XML_ENTITY_FORBIDDEN", "DTD and entities are forbidden");
  if (/<f(?:\s|>)/iu.test(xml) || /\bss:Formula\s*=/iu.test(xml)) {
    fail("IMPORT_FORMULA_FORBIDDEN", "Formula cells are forbidden and are never evaluated");
  }
}

function inferScalar(value) {
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) return Number(value);
  return value;
}

function recordsFromMatrix(matrix, limits) {
  if (matrix.length === 0) return [];
  const headers = matrix[0].map((value) => String(value));
  if (headers.length > limits.maxColumns) fail("IMPORT_RESOURCE_LIMIT", "Column limit exceeded");
  if (matrix.length - 1 > limits.maxRows) fail("IMPORT_RESOURCE_LIMIT", "Row limit exceeded");
  if (new Set(headers).size !== headers.length) fail("IMPORT_DUPLICATE_COLUMN", "Duplicate columns are forbidden");
  return matrix.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
  );
}

function readZip(buffer, limits) {
  if (buffer.length > limits.maxCompressedBytes) fail("IMPORT_RESOURCE_LIMIT", "Compressed file limit exceeded");
  const entries = new Map();
  let offset = 0;
  let totalDeclared = 0;
  try {
    while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
      const flags = buffer.readUInt16LE(offset + 6);
      const method = buffer.readUInt16LE(offset + 8);
      const compressedSize = buffer.readUInt32LE(offset + 18);
      const uncompressedSize = buffer.readUInt32LE(offset + 22);
      const nameLength = buffer.readUInt16LE(offset + 26);
      const extraLength = buffer.readUInt16LE(offset + 28);
      if (flags & 1) fail("IMPORT_ENCRYPTED_FILE", "Encrypted workbooks are forbidden");
      if (flags & 8) fail("IMPORT_UNSUPPORTED_ZIP", "Streaming ZIP descriptors are unsupported by the bounded parser");
      const nameStart = offset + 30;
      const contentStart = nameStart + nameLength + extraLength;
      const contentEnd = contentStart + compressedSize;
      if (contentEnd > buffer.length) fail("IMPORT_CORRUPT_ARCHIVE", "ZIP entry exceeds file boundary");
      const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
      if (!name || name.startsWith("/") || name.includes("../") || name.includes("\\")) {
        fail("IMPORT_UNSAFE_ARCHIVE_PATH", "Unsafe ZIP entry path");
      }
      totalDeclared += uncompressedSize;
      if (entries.size + 1 > limits.maxEntries || totalDeclared > limits.maxUncompressedBytes) {
        fail("IMPORT_RESOURCE_LIMIT", "ZIP uncompressed resource limit exceeded");
      }
      if (compressedSize === 0 ? uncompressedSize > 0 : uncompressedSize / compressedSize > limits.maxCompressionRatio) {
        fail("IMPORT_RESOURCE_LIMIT", "ZIP compression ratio limit exceeded");
      }
      if (name === "xl/vbaProject.bin") fail("IMPORT_MACRO_FORBIDDEN", "Macro-enabled workbooks are forbidden");
      const compressed = buffer.subarray(contentStart, contentEnd);
      let content;
      if (method === 0) content = compressed;
      else if (method === 8) content = inflateRawSync(compressed, { maxOutputLength: Math.min(uncompressedSize + 1, limits.maxUncompressedBytes + 1) });
      else fail("IMPORT_UNSUPPORTED_ZIP", `Unsupported compression method ${method}`);
      if (content.length !== uncompressedSize) fail("IMPORT_CORRUPT_ARCHIVE", "ZIP size mismatch");
      entries.set(name, content);
      offset = contentEnd;
    }
  } catch (error) {
    if (error instanceof ImportSecurityError) throw error;
    fail("IMPORT_CORRUPT_ARCHIVE", "ZIP decompression failed");
  }
  if (entries.size === 0 || offset + 4 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
    fail("IMPORT_CORRUPT_ARCHIVE", "ZIP central directory is missing");
  }
  return entries;
}

function guardCsvFormulae(buffer) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/u, "");
  let quoted = false;
  let atCellStart = true;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
      continue;
    }
    if (!quoted && (character === "," || character === "\n" || character === "\r")) {
      atCellStart = true;
      continue;
    }
    if (atCellStart) {
      if (/^[=+@]$/u.test(character)) fail("IMPORT_FORMULA_FORBIDDEN", "Formula-like CSV cells are forbidden");
      atCellStart = false;
    }
  }
  if (quoted) fail("IMPORT_MALFORMED_CSV", "Unclosed quoted field");
}

function sheetJsRecords(sheet, limits) {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
  if (range.e.r - range.s.r > limits.maxRows) fail("IMPORT_RESOURCE_LIMIT", "Row limit exceeded");
  if (range.e.c - range.s.c + 1 > limits.maxColumns) fail("IMPORT_RESOURCE_LIMIT", "Column limit exceeded");
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith("!")) continue;
    if (cell.f !== undefined) fail("IMPORT_FORMULA_FORBIDDEN", "Formula cells are forbidden and are never evaluated");
    if (String(cell.v ?? "").length > limits.maxCellCharacters) fail("IMPORT_RESOURCE_LIMIT", "Cell character limit exceeded");
  }
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
    UTC: true,
  }).map((row) => row.map((value) => {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return typeof value === "string" ? inferScalar(value) : value;
  }));
  return recordsFromMatrix(matrix, limits);
}

function parseWithSheetJs(buffer, extension, limits) {
  if (extension === "csv") guardCsvFormulae(buffer);
  if (extension === "xlsx") {
    const entries = readZip(buffer, limits);
    const shared = entries.get("xl/sharedStrings.xml");
    if (shared && shared.length > limits.maxSharedStringsBytes) fail("IMPORT_RESOURCE_LIMIT", "Shared strings limit exceeded");
    for (const [name, content] of entries) {
      if (name.endsWith(".xml") || name.endsWith(".rels")) guardXml(content.toString("utf8"));
    }
  } else if (extension === "xls" && buffer.subarray(0, 5).toString("utf8").includes("<?xml")) {
    guardXml(buffer.toString("utf8"));
  }

  let workbook;
  try {
    workbook = XLSX.read(buffer, {
      type: "buffer",
      raw: true,
      cellDates: true,
      cellFormula: true,
      cellNF: true,
      bookVBA: true,
      UTC: true,
      WTF: true,
      dense: false,
    });
  } catch (error) {
    const message = String(error?.message ?? error);
    if (/password|encrypt/iu.test(message)) fail("IMPORT_ENCRYPTED_FILE", "Encrypted workbook is forbidden");
    if (/formula/iu.test(message)) fail("IMPORT_FORMULA_FORBIDDEN", "Formula workbook is forbidden");
    fail(extension === "xlsx" ? "IMPORT_CORRUPT_ARCHIVE" : "IMPORT_MALFORMED_WORKBOOK", "SheetJS could not parse workbook");
  }
  if (workbook.vbaraw) fail("IMPORT_MACRO_FORBIDDEN", "Macro-enabled workbooks are forbidden");
  if (workbook.SheetNames.length === 0) fail("IMPORT_MALFORMED_WORKBOOK", "No worksheet found");
  const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
  return {
    engine: { name: "SheetJS", version: XLSX.version },
    format: extension,
    dateSystem: date1904 ? "1904" : "1900",
    sheets: workbook.SheetNames.map((name) => ({
      name,
      rows: sheetJsRecords(workbook.Sheets[name], limits),
    })),
  };
}

export function parseWorkbook(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) fail("IMPORT_INVALID_INPUT", "Input must be a Buffer");
  const limits = mergeLimits(options.limits);
  const extension = options.fileName?.split(".").pop()?.toLowerCase();
  if (!extension || !["csv", "xls", "xlsx"].includes(extension)) {
    fail("IMPORT_UNSUPPORTED_FORMAT", "Only csv, xls and xlsx are supported");
  }
  if (buffer.length === 0) fail("IMPORT_EMPTY_FILE", "Workbook is empty");
  if (buffer.length > limits.maxCompressedBytes) fail("IMPORT_RESOURCE_LIMIT", "Input file limit exceeded");
  return parseWithSheetJs(buffer, extension, limits);
}

export { DEFAULT_LIMITS, XLSX };
