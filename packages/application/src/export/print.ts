import type {
  ExportAssetManifestEntry,
  ExportSection,
  ExportSnapshot,
} from "./contracts.js";

export type PrintItem = Readonly<{
  id: string;
  name: string;
  description: string | null;
  expense: string | null;
  time: string | null;
  location: string | null;
  imageAssetIds: readonly string[];
}>;

export type PrintDay = Readonly<{
  id: string;
  dayNumber: number;
  date: string | null;
  title: string;
  items: readonly PrintItem[];
  mapAssetId: string | null;
}>;

export type PrintChapter = Readonly<{
  id: string;
  section: ExportSection;
  title: string;
  kind: "cover" | "overview" | "map" | "day" | "list" | "omissions";
  data: Readonly<Record<string, unknown>>;
  assetIds: readonly string[];
}>;

export type PrintManifest = Readonly<{
  referencedAssetIds: readonly string[];
  omittedAssets: readonly ExportAssetManifestEntry[];
  missingReferencedAssetIds: readonly string[];
}>;

const TITLES: Readonly<Record<ExportSection, string>> = {
  cover: "旅行计划",
  overview: "旅程概览",
  global_map: "全局地图",
  daily_itinerary: "每日行程",
  daily_map: "每日地图",
  gallery: "图片集锦",
  accommodation: "住宿汇总",
  transport: "交通汇总",
  expenses: "费用汇总",
  notes: "备注",
  omissions: "资源遗漏",
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
}

function facts(snapshot: ExportSnapshot): Record<string, unknown> {
  return object(snapshot.facts);
}

function daysFromSnapshot(snapshot: ExportSnapshot): readonly PrintDay[] {
  const source = array(facts(snapshot).days ?? facts(snapshot).dailyItinerary);
  return source.map((raw, index) => {
    const day = object(raw);
    const items = array(day.items ?? day.itinerary).map((rawItem, itemIndex) => {
      const item = object(rawItem);
      const imageAssetIds = array(item.imageAssetIds ?? item.assetIds)
        .map(text)
        .filter((value): value is string => value !== null);
      return {
        id: text(item.id) ?? `day-${index + 1}-item-${itemIndex + 1}`,
        name: text(item.name ?? item.target) ?? "未命名行程",
        description: text(item.description),
        expense: text(item.expense ?? item.cost),
        time: text(item.time ?? item.startTime),
        location: text(item.location ?? item.place),
        imageAssetIds,
      } satisfies PrintItem;
    });
    const dayNumber = number(day.dayNumber ?? day.number, index + 1);
    return {
      id: text(day.id) ?? `day-${dayNumber}`,
      dayNumber,
      date: text(day.date),
      title: text(day.title) ?? `Day ${dayNumber}`,
      items,
      mapAssetId: text(day.mapAssetId),
    } satisfies PrintDay;
  });
}

function chapterAssetIds(chapter: PrintChapter): readonly string[] {
  return chapter.assetIds.filter((value, index, all) => all.indexOf(value) === index);
}

export function buildPrintChapters(
  snapshot: ExportSnapshot,
  sections: readonly ExportSection[],
): readonly PrintChapter[] {
  const root = facts(snapshot);
  const days = daysFromSnapshot(snapshot);
  const globalMapAssetId = text(object(root.globalMap ?? root.maps).assetId);
  const gallery = array(root.gallery ?? root.images);
  const dailyAssets = days.flatMap((day) => day.mapAssetId ? [day.mapAssetId] : []);
  return sections.map((section) => {
    const data: Record<string, unknown> = {};
    let kind: PrintChapter["kind"] = "list";
    let assetIds: string[] = [];
    switch (section) {
      case "cover":
        kind = "cover";
        Object.assign(data, object(root.trip ?? root));
        break;
      case "overview":
        kind = "overview";
        Object.assign(data, object(root.overview));
        break;
      case "global_map":
        kind = "map";
        if (globalMapAssetId) assetIds.push(globalMapAssetId);
        data.assetId = globalMapAssetId;
        break;
      case "daily_itinerary":
        kind = "day";
        data.days = days;
        assetIds = days.flatMap((day) => day.items.flatMap((item) => [...item.imageAssetIds]));
        break;
      case "daily_map":
        kind = "map";
        data.days = days;
        assetIds = dailyAssets;
        break;
      case "gallery":
        kind = "list";
        data.items = gallery;
        assetIds = gallery.flatMap((entry) => {
          const item = object(entry);
          const assetId = text(item.assetId);
          return assetId ? [assetId] : [];
        });
        break;
      case "accommodation":
      case "transport":
      case "expenses":
      case "notes":
        data.items = array(root[section]);
        break;
      case "omissions":
        kind = "omissions";
        data.items = snapshot.assets.filter((asset) => asset.status !== "ready");
        break;
    }
    const chapter = {
      id: section,
      section,
      title: TITLES[section],
      kind,
      data,
      assetIds: chapterAssetIds({ id: section, section, title: TITLES[section], kind, data, assetIds }),
    } satisfies PrintChapter;
    return chapter;
  });
}

export function buildPrintManifest(
  snapshot: ExportSnapshot,
  chapters: readonly PrintChapter[],
): PrintManifest {
  const referencedAssetIds = chapters.flatMap(({ assetIds }) => assetIds)
    .filter((value, index, all) => all.indexOf(value) === index);
  const assets = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
  return {
    referencedAssetIds,
    omittedAssets: snapshot.assets.filter((asset) => asset.status !== "ready"),
    missingReferencedAssetIds: referencedAssetIds.filter((id) => !assets.has(id)),
  };
}
