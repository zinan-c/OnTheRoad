import type { MapMarker } from "./map-model.js";
import type { Selection } from "./store.js";

export function selectionFromTimeline(itemId: string, dayId?: string): Selection {
  return { kind: "item", id: itemId, itemId, ...(dayId ? { dayId } : {}) };
}

export function selectionFromMarker(marker: Pick<MapMarker, "id" | "itemId" | "dayId">): Selection {
  return { kind: "marker", id: marker.id, itemId: marker.itemId, dayId: marker.dayId };
}

export function selectionFromSegment(segmentId: string): Selection {
  return { kind: "segment", id: segmentId };
}

export function selectionUrl(tripId: string, selection: Selection | null): string {
  const url = new URL(`/trips/${encodeURIComponent(tripId)}`, "https://on-the-road.invalid");
  if (selection) {
    url.searchParams.set("selected", selection.id);
    url.searchParams.set("selectedKind", selection.kind);
    if (selection.itemId) url.searchParams.set("selectedItem", selection.itemId);
    if (selection.dayId) url.searchParams.set("selectedDay", selection.dayId);
  }
  return `${url.pathname}${url.search}`;
}

export function selectionFromUrl(url: string): Selection | null {
  const parsed = new URL(url, "https://on-the-road.invalid");
  const id = parsed.searchParams.get("selected");
  const kind = parsed.searchParams.get("selectedKind");
  if (!id || (kind !== "item" && kind !== "marker" && kind !== "segment")) return null;
  const itemId = parsed.searchParams.get("selectedItem") ?? (kind === "segment" ? undefined : id);
  const dayId = parsed.searchParams.get("selectedDay");
  return { kind, id, ...(itemId ? { itemId } : {}), ...(dayId ? { dayId } : {}) };
}
