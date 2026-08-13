import * as React from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, test } from "vitest";

import { PrintTemplate } from "../../apps/web/src/features/exports/print/print-template";
import { buildPrintChapters, buildPrintManifest } from "../../packages/application/src/export/print.js";
import { exportSnapshotHash } from "../../packages/application/src/export/snapshot.js";
import type { ExportSection, ExportSnapshot } from "../../packages/application/src/export/contracts.js";
import { renderPrintHtml } from "../../apps/pdf-worker/src/print-renderer.js";

const checksum = "a".repeat(64);
const sections: readonly ExportSection[] = [
  "cover",
  "overview",
  "global_map",
  "daily_itinerary",
  "daily_map",
  "gallery",
  "expenses",
  "notes",
  "omissions",
];

function snapshot(): ExportSnapshot {
  return {
    schemaVersion: 1,
    tripId: "trip-print-contract",
    tripVersion: 7,
    capturedAt: "2026-08-13T00:00:00.000Z",
    facts: {
      trip: { name: "冻结旅程", startDate: "2026-09-01", endDate: "2026-09-03" },
      overview: { travelers: 2, timezone: "Asia/Shanghai" },
      globalMap: { assetId: "map:global" },
      days: [{
        id: "day-1",
        dayNumber: 1,
        date: "2026-09-01",
        title: "外滩日",
        items: [{
          id: "item-1",
          name: "外滩",
          description: "只读快照内容",
          location: "黄浦区",
          imageAssetIds: ["image:day-1"],
        }],
        mapAssetId: "map:day-1",
      }],
      gallery: [{ assetId: "image:gallery", caption: "晚霞" }],
      expenses: [{ id: "expense-1", amount: "CNY 12" }],
      notes: ["不要读取实时 Trip"],
    },
    assets: [
      { id: "map:global", kind: "map", contentType: "image/png", checksumSha256: checksum, objectVersion: "global-v1", width: 1200, height: 800, required: true, status: "ready", omissionReason: null },
      { id: "map:day-1", kind: "map", contentType: "image/png", checksumSha256: checksum, objectVersion: "day-v1", width: 1200, height: 800, required: true, status: "ready", omissionReason: null },
      { id: "image:day-1", kind: "image", contentType: "image/jpeg", checksumSha256: null, objectVersion: null, width: null, height: null, required: false, status: "missing", omissionReason: "image source expired" },
      { id: "image:gallery", kind: "image", contentType: "image/jpeg", checksumSha256: checksum, objectVersion: "gallery-v1", width: 800, height: 600, required: false, status: "ready", omissionReason: null },
    ],
  };
}

function attribute(markup: string, name: string): string {
  const match = markup.match(new RegExp(`${name}="([^"]*)"`));
  if (!match?.[1]) throw new Error(`missing ${name}`);
  return match[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&");
}

function sectionsIn(markup: string): string[] {
  return [...markup.matchAll(/data-print-section="([^"]+)"/gu)].map((match) => match[1]!);
}

describe("TC-F03-03 Preview/worker same-template", () => {
  test("uses the same frozen snapshot chapters and asset manifest", () => {
    const frozen = snapshot();
    const snapshotHash = exportSnapshotHash(frozen);
    const chapters = buildPrintChapters(frozen, sections);
    const manifest = buildPrintManifest(frozen, chapters);
    const preview = renderToStaticMarkup(React.createElement(PrintTemplate, {
      snapshot: frozen,
      sections,
      templateVersion: "m4-print-v1",
      snapshotHash,
    }));
    const worker = renderPrintHtml(frozen, sections, [], "", "portrait", {
      templateVersion: "m4-print-v1",
      snapshotHash,
    });

    expect(sectionsIn(preview)).toEqual(sections);
    expect(sectionsIn(worker)).toEqual(sections);
    expect(attribute(preview, "data-template-version")).toBe("m4-print-v1");
    expect(attribute(worker, "data-template-version")).toBe("m4-print-v1");
    expect(attribute(preview, "data-snapshot-hash")).toBe(snapshotHash);
    expect(attribute(worker, "data-snapshot-hash")).toBe(snapshotHash);
    expect(JSON.parse(attribute(preview, "data-asset-manifest"))).toEqual(manifest.referencedAssetIds);
    expect(JSON.parse(attribute(worker, "data-asset-manifest"))).toEqual(manifest.referencedAssetIds);
    expect(JSON.parse(attribute(worker, "data-missing-asset-manifest"))).toEqual(manifest.missingReferencedAssetIds);
    expect(preview).toContain("image:day-1");
    expect(worker).toContain("只读快照内容");
  });
});
