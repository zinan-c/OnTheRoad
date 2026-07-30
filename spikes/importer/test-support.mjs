import { deflateRawSync } from "node:zlib";

import * as XLSX from "../../packages/importer/vendor/xlsx/xlsx.mjs";
import * as cptable from "../../packages/importer/vendor/xlsx/dist/cpexcel.full.mjs";

XLSX.set_cptable(cptable);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZip(entries, { declaredSizes = {}, entryFlags = {} } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name);
    const source = Buffer.from(value);
    const compressed = deflateRawSync(source);
    const declaredSize = declaredSizes[name] ?? source.length;
    const flags = entryFlags[name] ?? 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(source), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(declaredSize, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    locals.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(source), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(declaredSize, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function workbookXlsx({ date1904 = false, formula = false } = {}) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["date", "value"],
    [date1904 ? 1 : 2, "safe"],
  ]);
  sheet.A2.z = "yyyy-mm-dd";
  if (formula) sheet.B2 = { t: "n", v: 4, f: "2+2" };
  XLSX.utils.book_append_sheet(workbook, sheet, "Dates");
  workbook.Workbook = { WBProps: { date1904 } };
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellDates: false });
}
