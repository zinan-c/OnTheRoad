import { XLSX } from "./vendor/sheetjs-adapter.mjs";

const DEFAULT_LIMITS = Object.freeze({
  maximumBytes: 20 * 1024 * 1024,
  maximumExpandedBytes: 100 * 1024 * 1024,
  maximumCompressionRatio: 100,
  maximumSheets: 32,
  maximumRows: 5_000,
  maximumColumns: 256,
  maximumCells: 100_000,
  maximumSampleRows: 10,
});

export class WorkbookInspectError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {boolean} [retryable]
   * @param {unknown} [cause]
   */
  constructor(code, message, retryable = false, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WorkbookInspectError";
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * @typedef {{
 *  maximumBytes: number,
 *  maximumExpandedBytes: number,
 *  maximumCompressionRatio: number,
 *  maximumSheets: number,
 *  maximumRows: number,
 *  maximumColumns: number,
 *  maximumCells: number,
 *  maximumSampleRows: number
 * }} WorkbookLimits
 */

/**
 * @param {Buffer | Uint8Array | string} value
 * @param {{filename?: string, limits?: Partial<WorkbookLimits>, sampleRows?: number, includeRows?: boolean}} [options]
 */
export function inspectWorkbook(value, options) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const filename = String(options?.filename ?? "");
  const limits = { ...DEFAULT_LIMITS, ...options?.limits };
  const sampleRows = Math.min(
    options?.sampleRows ?? 5,
    limits.maximumSampleRows,
  );
  validatePositiveLimits(limits, sampleRows);
  if (body.byteLength === 0) {
    fail("WORKBOOK_EMPTY", "Workbook is empty.");
  }
  if (body.byteLength > limits.maximumBytes) {
    fail("WORKBOOK_SIZE_LIMIT", "Workbook exceeds the byte limit.");
  }

  const format = detectWorkbookFormat(filename, body);
  if (format === "xlsx") inspectZipEnvelope(body, limits);

  let workbook;
  try {
    workbook = XLSX.read(body, {
      type: "buffer",
      raw: true,
      cellDates: false,
      cellFormula: true,
      bookVBA: true,
      dense: false,
      WTF: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/password|encrypt/iu.test(message)) {
      throw new WorkbookInspectError(
        "WORKBOOK_ENCRYPTED",
        "Encrypted workbooks are not supported.",
        false,
        error,
      );
    }
    throw new WorkbookInspectError(
      "WORKBOOK_CORRUPT",
      "Workbook is corrupt or cannot be parsed.",
      false,
      error,
    );
  }
  if (workbook.vbaraw) {
    fail("WORKBOOK_MACRO_UNSUPPORTED", "Macro-enabled workbooks are not supported.");
  }
  if (workbook.SheetNames.length > limits.maximumSheets) {
    fail("WORKBOOK_SHEET_LIMIT", "Workbook exceeds the sheet limit.");
  }

  let totalRows = 0;
  let totalCells = 0;
  const sheets = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const inspected = inspectSheet(sheet, name, sampleRows, limits);
    if (!inspected) continue;
    totalRows += inspected.rowCount;
    totalCells += inspected.cellCount;
    if (totalRows > limits.maximumRows) {
      fail("WORKBOOK_ROW_LIMIT", "Workbook exceeds the row limit.");
    }
    if (totalCells > limits.maximumCells) {
      fail("WORKBOOK_CELL_LIMIT", "Workbook exceeds the cell limit.");
    }
    sheets.push({
      name,
      columns: inspected.columns,
      samples: inspected.samples,
      ...(options?.includeRows ? { rows: inspected.rows } : {}),
      rowCount: inspected.rowCount,
    });
  }
  if (sheets.length === 0) {
    fail("WORKBOOK_EMPTY", "Workbook does not contain a non-empty sheet.");
  }
  return {
    format,
    sheets,
    inspectedAt: new Date(0).toISOString(),
    limits: {
      bytes: body.byteLength,
      rows: totalRows,
      cells: totalCells,
      sheets: sheets.length,
    },
  };
}

/**
 * @param {Record<string, any>} sheet
 * @param {string} name
 * @param {number} sampleRows
 * @param {WorkbookLimits} limits
 */
function inspectSheet(sheet, name, sampleRows, limits) {
  const reference = sheet["!ref"];
  if (!reference) return undefined;
  let range;
  try {
    range = XLSX.utils.decode_range(reference);
  } catch (error) {
    throw new WorkbookInspectError(
      "WORKBOOK_CORRUPT",
      `Sheet ${name} has an invalid range.`,
      false,
      error,
    );
  }
  const rangeRows = range.e.r - range.s.r + 1;
  const rangeColumns = range.e.c - range.s.c + 1;
  if (rangeColumns > limits.maximumColumns) {
    fail("WORKBOOK_COLUMN_LIMIT", `Sheet ${name} exceeds the column limit.`);
  }
  if (rangeRows > limits.maximumRows + 1) {
    fail("WORKBOOK_ROW_LIMIT", `Sheet ${name} exceeds the row limit.`);
  }
  if (rangeRows * rangeColumns > limits.maximumCells + rangeColumns) {
    fail("WORKBOOK_CELL_LIMIT", `Sheet ${name} exceeds the cell limit.`);
  }

  /** @type {unknown[][]} */
  const matrix = [];
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const values = [];
    let nonEmpty = false;
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
      const value = inertCellValue(cell);
      values.push(value);
      if (value !== undefined && value !== "") nonEmpty = true;
    }
    if (nonEmpty) matrix.push(values);
  }
  if (matrix.length === 0) return undefined;

  const header = matrix[0];
  if (!header) return undefined;
  if (header[0] !== undefined) {
    header[0] = String(header[0]).replace(/^\uFEFF/u, "");
  }
  const columns = header.map((value, index) => {
    const text = value === undefined ? "" : String(value).trim();
    return text || `Column ${index + 1}`;
  });
  const dataRows = matrix.slice(1);
  const rows = dataRows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [
      column,
      row[index] ?? "",
    ])));
  const samples = rows.slice(0, sampleRows);
  return {
    columns,
    samples,
    rows,
    rowCount: dataRows.length,
    cellCount: matrix.length * columns.length,
  };
}

/** @param {any} cell */
function inertCellValue(cell) {
  if (!cell) return undefined;
  if (typeof cell.f === "string") return `=${cell.f}`;
  if (cell.v === undefined || cell.v === null) return undefined;
  if (cell.t === "b") return Boolean(cell.v);
  return cell.v;
}

/** @param {string} filename @param {Buffer} body */
function detectWorkbookFormat(filename, body) {
  const extension = filename.toLocaleLowerCase("en-US").split(".").pop() ?? "";
  if (extension === "xlsm" || extension === "xltm") {
    fail("WORKBOOK_MACRO_UNSUPPORTED", "Macro-enabled workbooks are not supported.");
  }
  if (!["xlsx", "xls", "csv"].includes(extension)) {
    fail("WORKBOOK_FORMAT_UNSUPPORTED", "Only xlsx, xls, and csv are supported.");
  }
  const zip = hasZipMagic(body);
  const cfb = hasCfbMagic(body);
  if (extension === "xlsx") {
    if (cfb) fail("WORKBOOK_ENCRYPTED", "Encrypted workbooks are not supported.");
    if (!zip) fail("WORKBOOK_MAGIC_MISMATCH", "XLSX ZIP signature is missing.");
    return "xlsx";
  }
  if (extension === "xls") {
    if (!cfb) fail("WORKBOOK_MAGIC_MISMATCH", "XLS compound-file signature is missing.");
    return "xls";
  }
  if (zip || cfb || body.includes(0)) {
    fail("WORKBOOK_MAGIC_MISMATCH", "CSV content does not match its filename.");
  }
  return "csv";
}

/** @param {Buffer} body @param {WorkbookLimits} limits */
function inspectZipEnvelope(body, limits) {
  let offset = 0;
  let entries = 0;
  let compressedBytes = 0;
  let expandedBytes = 0;
  while (offset <= body.length - 46) {
    if (body.readUInt32LE(offset) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const compressed = body.readUInt32LE(offset + 20);
    const expanded = body.readUInt32LE(offset + 24);
    const filenameLength = body.readUInt16LE(offset + 28);
    const extraLength = body.readUInt16LE(offset + 30);
    const commentLength = body.readUInt16LE(offset + 32);
    const end = offset + 46 + filenameLength + extraLength + commentLength;
    if (end > body.length) {
      fail("WORKBOOK_CORRUPT", "XLSX central directory is truncated.");
    }
    const entryName = body.subarray(offset + 46, offset + 46 + filenameLength)
      .toString("utf8");
    if (/vbaProject\.bin$/iu.test(entryName)) {
      fail("WORKBOOK_MACRO_UNSUPPORTED", "Macro projects are not supported.");
    }
    compressedBytes += compressed;
    expandedBytes += expanded;
    entries += 1;
    offset = end;
  }
  if (entries === 0) {
    fail("WORKBOOK_CORRUPT", "XLSX central directory is missing.");
  }
  if (expandedBytes > limits.maximumExpandedBytes) {
    fail("WORKBOOK_EXPANDED_SIZE_LIMIT", "XLSX expanded content exceeds the limit.");
  }
  const ratio = expandedBytes / Math.max(1, compressedBytes);
  if (ratio > limits.maximumCompressionRatio) {
    fail("WORKBOOK_ZIP_RATIO_LIMIT", "XLSX compression ratio exceeds the limit.");
  }
}

/** @param {Buffer} body */
function hasZipMagic(body) {
  return body.length >= 4
    && [0x04034b50, 0x06054b50, 0x08074b50].includes(body.readUInt32LE(0));
}

/** @param {Buffer} body */
function hasCfbMagic(body) {
  return body.length >= 8
    && body.subarray(0, 8).equals(
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    );
}

/** @param {WorkbookLimits} limits @param {number} sampleRows */
function validatePositiveLimits(limits, sampleRows) {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${name} must be a positive safe integer.`);
    }
  }
  if (!Number.isSafeInteger(sampleRows) || sampleRows < 0) {
    throw new TypeError("sampleRows must be a non-negative safe integer.");
  }
}

/** @param {string} code @param {string} message @returns {never} */
function fail(code, message) {
  throw new WorkbookInspectError(code, message, false);
}
