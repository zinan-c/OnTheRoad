import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

function zipEntry(buffer, requestedName) {
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const contentStart = nameStart + nameLength + extraLength;
    const compressed = buffer.subarray(contentStart, contentStart + compressedSize);
    if (name === requestedName) {
      if (method === 0) return compressed;
      if (method === 8) return inflateRawSync(compressed);
      throw new Error(`Unsupported ZIP compression method ${method}`);
    }
    offset = contentStart + compressedSize;
  }
  throw new Error(`Missing ZIP entry ${requestedName}`);
}

function extractVersion(text) {
  const match = text.match(/minimal-five-day@\d+/u);
  if (!match) throw new Error("Fixture version is absent from consumer asset");
  return match[0];
}

export async function consumeProviderFixture(packageRoot) {
  const fixture = JSON.parse(await readFile(join(packageRoot, "src/trips/minimal-five-day.json"), "utf8"));
  return {
    consumer: "provider",
    fixtureVersion: fixture.fixtureVersion,
    locations: fixture.locations,
    routes: fixture.routes,
  };
}

export async function consumeMapFixture(packageRoot) {
  const geojson = JSON.parse(await readFile(join(packageRoot, "maps/minimal-five-day.geojson"), "utf8"));
  return {
    consumer: "map",
    fixtureVersion: geojson.fixtureVersion,
    featureCount: geojson.features.length,
  };
}

export async function consumeImporterFixture(packageRoot) {
  const csvText = await readFile(join(packageRoot, "imports/minimal-five-day.csv"), "utf8");
  const xlsText = await readFile(join(packageRoot, "imports/minimal-five-day.xls"), "utf8");
  const xlsxBuffer = await readFile(join(packageRoot, "imports/minimal-five-day.xlsx"));
  const xlsxSheet = zipEntry(xlsxBuffer, "xl/worksheets/sheet1.xml").toString("utf8");
  const formatVersions = {
    csv: extractVersion(csvText),
    xls: extractVersion(xlsText),
    xlsx: extractVersion(xlsxSheet),
  };
  return {
    consumer: "importer",
    fixtureVersion: formatVersions.csv,
    formatVersions,
  };
}

export async function consumePdfTextFixture(packageRoot) {
  const html = await readFile(join(packageRoot, "pdf/minimal-five-day-50-pages.html"), "utf8");
  return {
    consumer: "pdf",
    fixtureVersion: extractVersion(html),
    pageCount: [...html.matchAll(/<section class="page"/gu)].length,
    containsChinese: /[\u3400-\u9fff]/u.test(html),
  };
}
