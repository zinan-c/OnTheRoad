import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { deflateRawSync } from "node:zlib";

import { minimalFiveDay } from "./trips/minimal-five-day.mjs";

const TEXT_ENCODER = new TextEncoder();
const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = 33;
const GENERATED_PATHS = [
  "images/day-01.svg",
  "images/day-02.svg",
  "images/day-03.svg",
  "images/day-04.svg",
  "images/day-05.svg",
  "imports/minimal-five-day.csv",
  "imports/minimal-five-day.xls",
  "imports/minimal-five-day.xlsx",
  "maps/minimal-five-day.geojson",
  "maps/neutral-grid.svg",
  "pdf/minimal-five-day-50-pages.html",
  "src/trips/minimal-five-day.json",
];

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function rows() {
  return minimalFiveDay.trip.days.flatMap((day) =>
    day.items.map((item) => {
      const location = minimalFiveDay.locations.find(({ id }) => id === item.locationId);
      return {
        fixtureVersion: minimalFiveDay.fixtureVersion,
        day: day.dayNumber,
        date: day.date,
        startTime: item.startTime,
        endTime: item.endTime,
        type: item.type,
        title: item.title,
        location: location.name,
        longitude: location.longitude,
        latitude: location.latitude,
        crs: location.crs,
      };
    }),
  );
}

function csv(records) {
  const columns = Object.keys(records[0]);
  const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
  return `\uFEFF${columns.map(quote).join(",")}\n${records
    .map((record) => columns.map((column) => quote(record[column])).join(","))
    .join("\n")}\n`;
}

function spreadsheetXml(records) {
  const columns = Object.keys(records[0]);
  const xmlRows = [columns, ...records.map((record) => columns.map((column) => record[column]))]
    .map((values) => `<Row>${values.map((value) => `<Cell><Data ss:Type="${typeof value === "number" ? "Number" : "String"}">${escapeXml(value)}</Data></Cell>`).join("")}</Row>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Itinerary"><Table>${xmlRows}</Table></Worksheet></Workbook>\n`;
}

function worksheetXml(records) {
  const columns = Object.keys(records[0]);
  const values = [columns, ...records.map((record) => columns.map((column) => record[column]))];
  const rowXml = values.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
      return typeof value === "number"
        ? `<c r="${ref}"><v>${value}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
}

function columnName(index) {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
    const nameBuffer = Buffer.from(name);
    const source = Buffer.from(content);
    const compressed = deflateRawSync(source, { level: 9 });
    const checksum = crc32(source);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(FIXED_DOS_TIME, 10);
    local.writeUInt16LE(FIXED_DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(source.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(FIXED_DOS_TIME, 12);
    central.writeUInt16LE(FIXED_DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(source.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function xlsx(records) {
  return zip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Itinerary" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/worksheets/sheet1.xml": worksheetXml(records),
  });
}

function mapGeoJson() {
  const features = [
    ...minimalFiveDay.locations.map((location) => ({
      type: "Feature",
      id: location.id,
      properties: { kind: "marker", name: location.name, crs: "WGS84" },
      geometry: { type: "Point", coordinates: [location.longitude, location.latitude] },
    })),
    ...minimalFiveDay.routes.map((route) => {
      const from = minimalFiveDay.locations.find(({ id }) => id === route.fromLocationId);
      const to = minimalFiveDay.locations.find(({ id }) => id === route.toLocationId);
      return {
        type: "Feature",
        id: route.id,
        properties: { kind: "route", dayId: route.dayId, mode: route.mode, style: route.style },
        geometry: { type: "LineString", coordinates: [[from.longitude, from.latitude], [to.longitude, to.latitude]] },
      };
    }),
  ];
  return { type: "FeatureCollection", fixtureVersion: minimalFiveDay.fixtureVersion, features };
}

function imageSvg(day) {
  const palette = ["#155e75", "#166534", "#9a3412", "#1d4ed8", "#6b21a8"];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800" role="img" aria-label="Day ${day.dayNumber} fixture image"><rect width="1200" height="800" fill="${palette[day.dayNumber - 1]}"/><path d="M0 580 Q300 390 600 560 T1200 500 V800 H0Z" fill="#ffffff" opacity=".2"/><text x="80" y="160" fill="#fff" font-family="sans-serif" font-size="72">DAY ${day.dayNumber}</text><text x="80" y="260" fill="#fff" font-family="sans-serif" font-size="50">${escapeXml(day.title)}</text><text x="80" y="710" fill="#fff" font-family="sans-serif" font-size="34">${day.date} · ${minimalFiveDay.fixtureVersion}</text></svg>\n`;
}

function neutralGridSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="640" viewBox="0 0 1024 640"><defs><pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M64 0H0V64" fill="none" stroke="#cbd5e1" stroke-width="1"/></pattern></defs><rect width="1024" height="640" fill="#f8fafc"/><rect width="1024" height="640" fill="url(#grid)"/><text x="512" y="306" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#475569">OFFLINE FIXTURE MAP</text><text x="512" y="348" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#64748b">上海 · 舟山 · 普陀山</text><text x="512" y="600" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#64748b">Synthetic local asset · ${minimalFiveDay.fixtureVersion}</text></svg>\n`;
}

function pdfTextHtml() {
  const days = minimalFiveDay.trip.days;
  const pages = Array.from({ length: 50 }, (_, index) => {
    const day = days[index % days.length];
    const item = day.items[index % day.items.length];
    return `<section class="page" data-page="${index + 1}"><header>${minimalFiveDay.trip.name} · ${minimalFiveDay.fixtureVersion}</header><main><h1>第 ${index + 1} 页 / Page ${index + 1}</h1><h2>Day ${day.dayNumber} · ${escapeXml(day.title)}</h2><p>${escapeXml(item.title)}，地点：${escapeXml(minimalFiveDay.locations.find(({ id }) => id === item.locationId).name)}。</p><p>这是用于中文字体、分页、页眉页脚和文本提取验证的确定性离线内容。</p></main><footer>On The Road · ${index + 1} / 50</footer></section>`;
  }).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${minimalFiveDay.fixtureVersion}</title><style>@page{size:A4;margin:16mm}.page{box-sizing:border-box;break-after:page;min-height:250mm;display:grid;grid-template-rows:auto 1fr auto;font-family:"Noto Sans CJK SC","PingFang SC",sans-serif}.page:last-child{break-after:auto}header,footer{color:#475569}h1{margin-top:35mm}</style></head><body>${pages}</body></html>\n`;
}

async function write(root, path, content) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

export async function listFiles(root) {
  const output = [];
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else output.push(relative(root, fullPath));
    }
  }
  await walk(root);
  return output;
}

export async function hashFixtureTree(root) {
  const hash = createHash("sha256");
  for (const path of GENERATED_PATHS) {
    hash.update(path);
    hash.update("\0");
    hash.update(await readFile(join(root, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function generateFixtures(root) {
  const records = rows();
  await write(root, "src/trips/minimal-five-day.json", stableJson(minimalFiveDay));
  await write(root, "imports/minimal-five-day.csv", csv(records));
  await write(root, "imports/minimal-five-day.xls", spreadsheetXml(records));
  await write(root, "imports/minimal-five-day.xlsx", xlsx(records));
  await write(root, "maps/minimal-five-day.geojson", stableJson(mapGeoJson()));
  await write(root, "maps/neutral-grid.svg", neutralGridSvg());
  for (const day of minimalFiveDay.trip.days) {
    await write(root, `images/day-${String(day.dayNumber).padStart(2, "0")}.svg`, imageSvg(day));
  }
  await write(root, "pdf/minimal-five-day-50-pages.html", pdfTextHtml());

  const assets = {};
  for (const path of GENERATED_PATHS) {
    assets[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex");
  }
  const manifest = {
    fixtureVersion: minimalFiveDay.fixtureVersion,
    schemaVersion: minimalFiveDay.schemaVersion,
    generatedAt: minimalFiveDay.generatedAt,
    generator: "scripts/generate-fixtures.mjs",
    networkRequired: false,
    provenance: "Synthetic test data authored for On The Road; no third-party binary assets.",
    license: "Project test fixture; internal use.",
    treeSha256: await hashFixtureTree(root),
    assets,
  };
  await write(root, "manifest.json", stableJson(manifest));
  return manifest;
}

export function containsExternalReference(buffer) {
  if (buffer.includes(0)) return false;
  const text = new TextDecoder().decode(buffer).replaceAll("http://www.w3.org/2000/svg", "");
  return /\b(?:https?:)?\/\/|data:/iu.test(text);
}
