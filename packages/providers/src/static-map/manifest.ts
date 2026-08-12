import type { Wgs84Point } from "../contracts/dto.js";

export const STATIC_MAP_ASSET_STATUSES = [
  "ready",
  "processing",
  "missing",
  "failed",
  "excluded",
] as const;

export type StaticMapAssetStatus = (typeof STATIC_MAP_ASSET_STATUSES)[number];

export type StaticMapAssetScope = "overview" | "day" | "item";

export type StaticMapAssetContentType =
  | "image/png"
  | "image/webp";

export type StaticMapBounds = Readonly<{
  north: number;
  south: number;
  east: number;
  west: number;
}>;

export type StaticMapMarkerManifest = Readonly<{
  id: string;
  label: string;
  dayNumber: number | null;
  color: string;
  point: Wgs84Point;
}>;

export type StaticMapRouteManifest = Readonly<{
  id: string;
  color: string;
  pointCount: number;
  approximate: boolean;
}>;

export type StaticMapLegendEntry = Readonly<{
  label: string;
  color: string;
  kind: "marker" | "route" | "degraded";
}>;

/** Durable metadata for a map output referenced by an export snapshot. */
export type StaticMapAssetManifest = Readonly<{
  assetId: string;
  scope: StaticMapAssetScope;
  contentType: StaticMapAssetContentType;
  status: StaticMapAssetStatus;
  checksumSha256: string | null;
  width: number;
  height: number;
  pixelRatio: 1 | 2;
  bounds: StaticMapBounds | null;
  markers: readonly StaticMapMarkerManifest[];
  routes: readonly StaticMapRouteManifest[];
  legend: readonly StaticMapLegendEntry[];
  attribution: string;
  degraded: boolean;
  degradationReason: string | null;
}>;

export type StaticMapRenderPolicy = "fixture" | "allowlisted" | "disabled";

export type StaticMapTilePolicy = Readonly<{
  mode: StaticMapRenderPolicy;
  allowedHosts: readonly string[];
}>;

export type StaticMapRenderRequest = Readonly<{
  scope: StaticMapAssetScope;
  width: number;
  height: number;
  pixelRatio: 1 | 2;
  markers: readonly StaticMapMarkerManifest[];
  routes: readonly StaticMapRouteManifest[];
  legend: readonly StaticMapLegendEntry[];
  attribution: string;
  tilePolicy: StaticMapTilePolicy;
}>;

export function assertStaticMapAssetManifest(
  manifest: StaticMapAssetManifest,
): void {
  if (!manifest.assetId.trim()) {
    throw new Error("static map assetId must not be empty");
  }

  if (!STATIC_MAP_ASSET_STATUSES.includes(manifest.status)) {
    throw new Error(`unsupported static map asset status: ${manifest.status}`);
  }

  if (!Number.isInteger(manifest.width) || manifest.width <= 0) {
    throw new Error("static map width must be a positive integer");
  }

  if (!Number.isInteger(manifest.height) || manifest.height <= 0) {
    throw new Error("static map height must be a positive integer");
  }

  if (manifest.pixelRatio !== 1 && manifest.pixelRatio !== 2) {
    throw new Error("static map pixelRatio must be 1 or 2");
  }

  if (manifest.status === "ready") {
    if (!manifest.checksumSha256 || !/^[a-f0-9]{64}$/.test(manifest.checksumSha256)) {
      throw new Error("ready static map assets require a SHA-256 checksum");
    }
  }

  if (manifest.checksumSha256 !== null && !/^[a-f0-9]{64}$/.test(manifest.checksumSha256)) {
    throw new Error("static map checksum must be SHA-256 hex");
  }

  if (!manifest.attribution.trim()) {
    throw new Error("static map attribution is required");
  }

  if (!Array.isArray(manifest.markers) || !Array.isArray(manifest.routes) || !Array.isArray(manifest.legend)) {
    throw new Error("static map manifest must include marker, route and legend arrays");
  }

  const markerIds = new Set<string>();
  for (const marker of manifest.markers) {
    if (!marker.id.trim() || !marker.label.trim() || markerIds.has(marker.id)) {
      throw new Error("static map marker ids and labels must be unique and non-empty");
    }
    markerIds.add(marker.id);
    if (!Number.isFinite(marker.point.longitude) || !Number.isFinite(marker.point.latitude)) {
      throw new Error("static map marker coordinates must be finite");
    }
  }

  const routeIds = new Set<string>();
  for (const route of manifest.routes) {
    if (!route.id.trim() || routeIds.has(route.id) || !Number.isSafeInteger(route.pointCount) || route.pointCount < 2) {
      throw new Error("static map routes require unique ids and at least two points");
    }
    routeIds.add(route.id);
  }

  for (const entry of manifest.legend) {
    if (!entry.label.trim() || !entry.color.trim()) {
      throw new Error("static map legend entries require a label and color");
    }
  }

  if (manifest.degraded && !manifest.degradationReason?.trim()) {
    throw new Error("degraded static map assets require a degradation reason");
  }

  if (!manifest.degraded && manifest.degradationReason !== null) {
    throw new Error("non-degraded static map assets cannot have a degradation reason");
  }
}
