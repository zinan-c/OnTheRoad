import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { buildPrintChapters, buildPrintManifest, type PrintChapter, type PrintDay, type PrintItem } from "@on-the-road/application/export/print";
import type { ExportSection, ExportSnapshot } from "@on-the-road/application/export";
import { exportSnapshotHash } from "@on-the-road/application/export/snapshot";
import { createStaticMapAssetProvider, type StaticMapRouteGeometry } from "@on-the-road/providers/static-map/renderer";
import { chromium } from "@playwright/test";
import type { PdfPrintRenderer } from "./pdf-processor.js";
import type { PdfExportJob } from "./export-stage-machine.js";

const DEFAULT_FONT_PATH = fileURLToPath(new URL("../fonts/NotoSansCJKsc-Regular.otf", import.meta.url));
const DEFAULT_SECTIONS = [
  "cover", "overview", "global_map", "daily_itinerary", "daily_map",
  "gallery", "accommodation", "transport", "expenses", "notes", "omissions",
] as const;
const COLORS = ["#2563eb", "#16a34a", "#f97316", "#9333ea", "#dc2626", "#0891b2"] as const;

export type RenderedMapAsset = Readonly<{
  assetId: string;
  bytes: Uint8Array;
  checksumSha256: string;
  width: number;
  height: number;
  objectKey?: string;
  objectVersion?: string;
  dataUrl: string;
}>;
type Wgs84Point = Readonly<{ longitude: number; latitude: number; crs: "WGS84" }>;
type RenderItem = PrintItem & Readonly<{ point: Wgs84Point | null }>;
type RenderDay = Omit<PrintDay, "items"> & Readonly<{ items: readonly RenderItem[] }>;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function point(value: unknown): Wgs84Point | null {
  const candidate = object(value);
  const longitude = Number(candidate.longitude);
  const latitude = Number(candidate.latitude);
  if (candidate.crs !== "WGS84" || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
  return { longitude, latitude, crs: "WGS84" };
}

function geometryCoordinates(value: unknown): readonly Wgs84Point[] {
  const geometry = object(value);
  const coordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  if (geometry.type !== "LineString") return [];
  return coordinates.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) return [];
    const candidate = { longitude: Number(entry[0]), latitude: Number(entry[1]), crs: "WGS84" as const };
    return point(candidate) ? [candidate] : [];
  });
}

function mapScope(assetId: string): "overview" | "day" {
  return assetId === "map:overview" ? "overview" : "day";
}

function dayNumber(day: PrintDay): number {
  return Number.isSafeInteger(day.dayNumber) ? day.dayNumber : 0;
}

function snapshotDays(snapshot: ExportSnapshot): readonly RenderDay[] {
  const facts = object(snapshot.facts);
  const source = Array.isArray(facts.days) ? facts.days : [];
  return source.map((rawDay, dayIndex) => {
    const day = object(rawDay);
    const rawItems = Array.isArray(day.items) ? day.items : [];
    const items = rawItems.map((rawItem, itemIndex) => {
      const item = object(rawItem);
      const imageAssetIds = (Array.isArray(item.imageAssetIds) ? item.imageAssetIds : [])
        .filter((value): value is string => typeof value === "string");
      return {
        id: text(item.id) ?? `day-${dayIndex + 1}-item-${itemIndex + 1}`,
        name: text(item.name ?? item.target) ?? "未命名行程",
        description: text(item.description),
        expense: text(item.expense ?? item.cost),
        time: text(item.time ?? item.startTime),
        location: text(item.location ?? item.place),
        imageAssetIds,
        point: point(item.point),
      } satisfies RenderItem;
    });
    const rawDayNumber = Number(day.dayNumber ?? day.number);
    const valueDayNumber = Number.isSafeInteger(rawDayNumber) ? rawDayNumber : dayIndex + 1;
    return {
      id: text(day.id) ?? `day-${valueDayNumber}`,
      dayNumber: valueDayNumber,
      date: text(day.date),
      title: text(day.title) ?? `Day ${valueDayNumber}`,
      items,
      mapAssetId: text(day.mapAssetId),
    } satisfies RenderDay;
  });
}

function routeGeometries(snapshot: ExportSnapshot): readonly StaticMapRouteGeometry[] {
  const routes = Array.isArray(snapshot.facts.routes) ? snapshot.facts.routes : [];
  return routes.flatMap((entry, index) => {
    const route = object(entry);
    const coordinates = geometryCoordinates(route.geometry);
    if (coordinates.length < 2) return [];
    return [{
      id: text(route.id) ?? `route-${index + 1}`,
      color: text(route.color) ?? "#155eef",
      approximate: route.quality === "approximate" || route.approximate === true,
      coordinates,
    }];
  });
}

function markers(days: readonly RenderDay[], selectedDayId?: string): {
  markers: Array<{ id: string; label: string; dayNumber: number | null; color: string; point: Wgs84Point }>;
  dayItems: readonly RenderItem[];
} {
  const selected = selectedDayId ? days.filter((day) => day.id === selectedDayId) : days;
  const result: Array<{ id: string; label: string; dayNumber: number | null; color: string; point: Wgs84Point }> = [];
  for (const [dayIndex, day] of selected.entries()) {
    for (const item of day.items) {
      if (!item.point) continue;
      result.push({
        id: item.id,
        label: item.name,
        dayNumber: dayNumber(day),
        color: COLORS[dayIndex % COLORS.length]!,
        point: item.point,
      });
    }
  }
  return { markers: result, dayItems: selected.flatMap((day) => day.items) };
}

async function renderMaps(
  snapshot: ExportSnapshot,
  persist?: (asset: RenderedMapAsset) => Promise<Readonly<{ objectKey: string; objectVersion: string }>>,
): Promise<readonly RenderedMapAsset[]> {
  const days = snapshotDays(snapshot);
  const routes = routeGeometries(snapshot);
  const provider = createStaticMapAssetProvider();
  const mapAssets = snapshot.assets.filter((asset) => asset.kind === "map");
  const rendered: RenderedMapAsset[] = [];
  for (const asset of mapAssets) {
    const selectedDayId = asset.id.startsWith("map:day:") ? asset.id.slice("map:day:".length) : undefined;
    const selected = markers(days, selectedDayId);
    const routeSelection = selectedDayId
      ? routes.filter((route) => {
        const day = days.find((candidate) => candidate.id === selectedDayId);
        return day?.items.some((item) => route.coordinates.some((coordinate) => item.point?.longitude === coordinate.longitude && item.point?.latitude === coordinate.latitude));
      })
      : routes;
    const result = await provider.render({
      assetId: asset.id,
      scope: mapScope(asset.id),
      width: 1024,
      height: 576,
      pixelRatio: 2,
      markers: selected.markers,
      routes: routeSelection.map((route) => ({ id: route.id, color: route.color, pointCount: route.coordinates.length, approximate: route.approximate })),
      routeGeometries: routeSelection,
      legend: [
        { label: "行程点", color: "#2563eb", kind: "marker" },
        { label: "路线", color: "#155eef", kind: "route" },
      ],
      attribution: "On The Road fixture",
      tilePolicy: { mode: "fixture", allowedHosts: [] },
    });
    const renderedAsset: RenderedMapAsset = {
      assetId: asset.id,
      bytes: result.bytes,
      checksumSha256: result.manifest.checksumSha256!,
      width: result.manifest.width,
      height: result.manifest.height,
      dataUrl: `data:image/png;base64,${Buffer.from(result.bytes).toString("base64")}`,
    };
    rendered.push(persist ? { ...renderedAsset, ...(await persist(renderedAsset)) } : renderedAsset);
  }
  return rendered;
}

function snapshotWithRenderedMaps(
  snapshot: ExportSnapshot,
  maps: readonly RenderedMapAsset[],
): ExportSnapshot {
  const rendered = new Map(maps.map((asset) => [asset.assetId, asset]));
  return {
    ...snapshot,
    assets: snapshot.assets.map((asset) => {
      const map = rendered.get(asset.id);
      if (!map) return asset;
      return {
        ...asset,
        status: "ready" as const,
        checksumSha256: map.checksumSha256,
        objectVersion: map.objectVersion ?? `runtime-${map.checksumSha256.slice(0, 16)}`,
        width: map.width,
        height: map.height,
        omissionReason: null,
      };
    }),
  };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function json(value: unknown): string {
  return escapeHtml(JSON.stringify(value) ?? "");
}

function printItem(item: PrintItem): string {
  return `<li><h3>${escapeHtml(item.name)}</h3>${item.time ? `<p>${escapeHtml(item.time)}</p>` : ""}${item.location ? `<p>${escapeHtml(item.location)}</p>` : ""}${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}${item.expense ? `<p>Expense: ${escapeHtml(item.expense)}</p>` : ""}</li>`;
}

function chapterHtml(chapter: PrintChapter, maps: ReadonlyMap<string, string>): string {
  const data = chapter.data;
  if (chapter.kind === "cover") {
    return `<div class="cover"><p>${escapeHtml(text(data.name ?? data.title) ?? "未命名旅程")}</p><p>${escapeHtml(text(data.startDate) ?? "")}${text(data.endDate) ? ` — ${escapeHtml(text(data.endDate)!)}` : ""}</p></div>`;
  }
  if (chapter.kind === "overview") {
    const entries = Object.entries(data).filter(([, value]) => ["string", "number"].includes(typeof value));
    return entries.length === 0 ? "<p>暂无概览信息。</p>" : `<dl>${entries.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join("")}</dl>`;
  }
  if (chapter.kind === "map") {
    const days = Array.isArray(data.days) ? data.days as readonly PrintDay[] : [];
    const assetIds = [text(data.assetId), ...days.map((day) => day.mapAssetId)].filter((value): value is string => Boolean(value));
    return assetIds.length === 0
      ? "<p>暂无地图资源，详见遗漏清单。</p>"
      : assetIds.map((assetId) => maps.has(assetId) ? `<figure><img src="${maps.get(assetId)}" alt="${escapeHtml(assetId)}"><figcaption>${escapeHtml(assetId)}</figcaption></figure>` : `<p>地图资源 ${escapeHtml(assetId)} 暂不可用。</p>`).join("");
  }
  if (chapter.kind === "day") {
    const days = Array.isArray(data.days) ? data.days as readonly PrintDay[] : [];
    return days.length === 0 ? "<p>暂无每日行程。</p>" : days.map((day) => `<article><h2>${escapeHtml(day.title)}${day.date ? ` · ${escapeHtml(day.date)}` : ""}</h2>${day.items.length === 0 ? "<p>当天没有行程安排。</p>" : `<ol>${day.items.map(printItem).join("")}</ol>`}</article>`).join("");
  }
  if (chapter.kind === "omissions") {
    const items = Array.isArray(data.items) ? data.items : [];
    return items.length === 0 ? "<p>没有遗漏资源。</p>" : `<ul>${items.map((item) => `<li>${json(item)}</li>`).join("")}</ul>`;
  }
  const items = Array.isArray(data.items) ? data.items : [];
  return items.length === 0 ? "<p>暂无内容。</p>" : `<ul>${items.map((item) => `<li>${json(item)}</li>`).join("")}</ul>`;
}

export function renderPrintHtml(
  snapshot: ExportSnapshot,
  sections: readonly string[],
  maps: readonly RenderedMapAsset[],
  fontData: string,
  orientation: "portrait" | "landscape",
  metadata: Readonly<{ templateVersion?: string; snapshotHash?: string | null }> = {},
): string {
  const chapters = buildPrintChapters(snapshot, sections.filter((section): section is ExportSection => typeof section === "string"));
  const manifest = buildPrintManifest(snapshot, chapters);
  const templateVersion = metadata.templateVersion ?? "m4-print-v1";
  const snapshotHash = metadata.snapshotHash === undefined ? exportSnapshotHash(snapshot) : metadata.snapshotHash;
  const mapLookup = new Map(maps.map((asset) => [asset.assetId, asset.dataUrl]));
  const pageWidth = orientation === "portrait" ? "210mm" : "297mm";
  const pageHeight = orientation === "portrait" ? "296mm" : "209mm";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
@font-face{font-family:OtrNoto;src:url(data:font/otf;base64,${fontData}) format("opentype");}
@page{size:A4 ${orientation};margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#1f2937;font-family:OtrNoto,"Noto Sans CJK SC",sans-serif}.page{width:${pageWidth};min-height:${pageHeight};padding:18mm;break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}.page h1,.page h2,.page h3{break-after:avoid}.page p,.page li{overflow-wrap:anywhere}.cover{min-height:calc(${pageHeight} - 36mm);display:flex;flex-direction:column;justify-content:center;background:#163f3a;color:#fff;padding:18mm;font-size:16pt}.cover p:first-child{font-size:32pt;margin:0 0 8mm}.page dl div{display:flex;gap:8mm;border-bottom:.2mm solid #e5e7eb;padding:2mm 0}.page dt{font-weight:700;min-width:28mm}.page dd{margin:0}.page article{break-inside:avoid}.page figure{margin:5mm 0;break-inside:avoid}.page figure img{width:100%;height:92mm;object-fit:contain;border:.3mm solid #d1d5db}.page figcaption{font-size:8pt;color:#6b7280}.page ol,.page ul{padding-left:7mm}.page li{margin:2mm 0}.page li h3{margin:0 0 1mm}
</style></head><body><main class="otrPrintDocument" data-template-version="${escapeHtml(templateVersion)}"${snapshotHash ? ` data-snapshot-hash="${escapeHtml(snapshotHash)}"` : ""} data-asset-manifest="${json(manifest.referencedAssetIds)}" data-missing-asset-manifest="${json(manifest.missingReferencedAssetIds)}">${chapters.map((chapter) => `<section class="otrPrintChapter otrPrintChapter--${escapeHtml(chapter.kind)} page" data-print-section="${escapeHtml(chapter.section)}" aria-labelledby="print-heading-${escapeHtml(chapter.id)}"><h1 id="print-heading-${escapeHtml(chapter.id)}">${escapeHtml(chapter.title)}</h1>${chapterHtml(chapter, mapLookup)}</section>`).join("")}</main></body></html>`;
}

export class PlaywrightPdfPrintRenderer implements PdfPrintRenderer {
  readonly #fontPath: string;
  readonly #persistMapAsset: ((job: PdfExportJob, asset: RenderedMapAsset) => Promise<Readonly<{ objectKey: string; objectVersion: string }>>) | undefined;
  readonly #deleteMapAsset: ((asset: Readonly<{ objectKey: string; objectVersion: string }>) => Promise<void>) | undefined;
  readonly #persistedMaps = new Map<string, Array<{ objectKey: string; objectVersion: string }>>();

  constructor(options: Readonly<{
    fontPath?: string;
    persistMapAsset?: (job: PdfExportJob, asset: RenderedMapAsset) => Promise<Readonly<{ objectKey: string; objectVersion: string }>>;
    deleteMapAsset?: (asset: Readonly<{ objectKey: string; objectVersion: string }>) => Promise<void>;
  }> = {}) {
    this.#fontPath = options.fontPath ?? process.env.OTR_PDF_FONT_PATH ?? DEFAULT_FONT_PATH;
    this.#persistMapAsset = options.persistMapAsset;
    this.#deleteMapAsset = options.deleteMapAsset;
  }

  async render(input: Readonly<{ job: PdfExportJob; snapshot: ExportSnapshot; signal: AbortSignal }>): Promise<Uint8Array> {
    if (input.signal.aborted) throw new Error("PDF_RENDER_CANCELLED");
    let maps: readonly RenderedMapAsset[] = [];
    try {
      const font = await readFile(this.#fontPath);
      maps = await renderMaps(
        input.snapshot,
        this.#persistMapAsset
          ? async (asset) => {
            const persisted = await this.#persistMapAsset!(input.job, asset);
            const current = this.#persistedMaps.get(input.job.id) ?? [];
            current.push({ objectKey: persisted.objectKey, objectVersion: persisted.objectVersion });
            this.#persistedMaps.set(input.job.id, current);
            return persisted;
          }
          : undefined,
      );
      const sections = input.job.options?.sections.length ? input.job.options.sections : DEFAULT_SECTIONS;
      const renderedSnapshot = snapshotWithRenderedMaps(input.snapshot, maps);
      const html = renderPrintHtml(
        renderedSnapshot,
        sections,
        maps,
        font.toString("base64"),
        input.job.options?.orientation ?? "portrait",
        { templateVersion: input.job.templateVersion, snapshotHash: input.job.snapshotHash },
      );
      const browser = await chromium.launch({
        headless: true,
        args: process.env.OTR_PDF_DISABLE_CHROMIUM_SANDBOX === "1"
          ? ["--disable-dev-shm-usage", "--no-sandbox"]
          : ["--disable-dev-shm-usage"],
      });
      try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(async (image) => {
          try { await image.decode(); } catch { /* omission is represented in the print chapter */ }
        }));
      });
      if (input.signal.aborted) throw new Error("PDF_RENDER_CANCELLED");
      const pdf = await page.pdf({
        format: "A4",
        landscape: input.job.options?.orientation === "landscape",
        printBackground: true,
        preferCSSPageSize: true,
      });
      const bytes = new Uint8Array(pdf);
      if (bytes.byteLength < 20 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
        throw new Error("PDF_RENDER_INVALID");
      }
      return bytes;
      } finally {
        await browser.close();
      }
    } catch (error) {
      await this.cleanup(input.job.id);
      throw error;
    }
  }

  async cleanup(jobId: string): Promise<void> {
    const persisted = this.#persistedMaps.get(jobId) ?? [];
    this.#persistedMaps.delete(jobId);
    if (!this.#deleteMapAsset) return;
    await Promise.all(persisted.map((asset) => this.#deleteMapAsset!(asset)));
  }

  async finalize(jobId: string): Promise<void> {
    this.#persistedMaps.delete(jobId);
  }
}
