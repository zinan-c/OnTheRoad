import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

import type { Wgs84Point } from "../contracts/dto.js";
import {
  assertStaticMapAssetManifest,
  type StaticMapAssetManifest,
  type StaticMapBounds,
  type StaticMapLegendEntry,
  type StaticMapMarkerManifest,
  type StaticMapRenderRequest,
} from "./manifest.js";

const MAX_LOGICAL_EDGE = 2_048;
const BACKGROUND = [244, 246, 248] as const;
const GRID = [217, 225, 232] as const;
const BORDER = [152, 162, 179] as const;
const DEFAULT_MARKER = "#2563eb";
const DEFAULT_ROUTE = "#155eef";

export type StaticMapRouteGeometry = Readonly<{
  id: string;
  color: string;
  approximate: boolean;
  coordinates: readonly Wgs84Point[];
}>;

export type StaticMapAssetRenderRequest = StaticMapRenderRequest & Readonly<{
  assetId: string;
  bounds?: StaticMapBounds | null;
  routeGeometries?: readonly StaticMapRouteGeometry[];
}>;

export type StaticMapAssetRenderResult = Readonly<{
  manifest: StaticMapAssetManifest;
  bytes: Uint8Array;
}>;

export interface StaticMapAssetProvider {
  render(request: StaticMapAssetRenderRequest): Promise<StaticMapAssetRenderResult>;
}

/**
 * Renders a deterministic print map without making network requests.
 * Fixture mode is a real offline base layer; other policies deliberately
 * retain the same readable grid and mark the asset as degraded.
 */
export function renderStaticMapAsset(
  request: StaticMapAssetRenderRequest,
): StaticMapAssetRenderResult {
  assertRenderRequest(request);
  const outputWidth = request.width * request.pixelRatio;
  const outputHeight = request.height * request.pixelRatio;
  const routeGeometries = request.routeGeometries ?? [];
  const points = [
    ...request.markers.map(({ point }) => point),
    ...routeGeometries.flatMap(({ coordinates }) => coordinates),
  ];
  const bounds = fitBounds(points, request.bounds ?? null);
  const pixels = new Uint8Array(outputWidth * outputHeight * 3);
  fill(pixels, BACKGROUND);
  drawGrid(pixels, outputWidth, outputHeight, request.pixelRatio);
  drawBorder(pixels, outputWidth, outputHeight, request.pixelRatio);

  const mapContent = routeGeometries.some(({ coordinates }) => coordinates.length >= 2)
    || request.markers.length > 0;
  const degradationReasons: string[] = [];
  if (request.degradationReason?.trim()) degradationReasons.push(request.degradationReason.trim());
  if (request.tilePolicy.mode !== "fixture") {
    degradationReasons.push(request.tilePolicy.mode === "disabled"
      ? "tile policy is disabled"
      : "network tile rendering is unavailable in the offline print renderer");
  }
  if (!mapContent) degradationReasons.push("no marker or route geometry was available");

  for (const route of routeGeometries) {
    drawPolyline(
      pixels,
      outputWidth,
      outputHeight,
      bounds,
      route.coordinates,
      parseColor(route.color, DEFAULT_ROUTE),
      request.pixelRatio,
      route.approximate,
    );
  }
  for (const marker of request.markers) {
    drawMarker(
      pixels,
      outputWidth,
      outputHeight,
      bounds,
      marker,
      request.pixelRatio,
    );
  }
  if (detectStaticMapBlank(pixels)) degradationReasons.push("map feature layer is blank");
  const degraded = degradationReasons.length > 0;
  const degradationReason = degraded ? degradationReasons.join("; ") : null;
  const legend = degraded && !request.legend.some(({ kind }) => kind === "degraded")
    ? [...request.legend, {
      label: degradationReason ?? "degraded map",
      color: "#667085",
      kind: "degraded" as const,
    }]
    : [...request.legend];
  drawLegend(pixels, outputWidth, outputHeight, legend, request.pixelRatio);
  const bytes = encodePng(pixels, outputWidth, outputHeight);
  const manifest: StaticMapAssetManifest = {
    assetId: request.assetId,
    scope: request.scope,
    contentType: "image/png",
    status: "ready",
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    width: request.width,
    height: request.height,
    pixelRatio: request.pixelRatio,
    bounds,
    markers: request.markers,
    routes: request.routes,
    legend,
    attribution: request.attribution,
    degraded,
    degradationReason,
  };
  assertStaticMapAssetManifest(manifest);
  return { manifest, bytes };
}

export function createStaticMapAssetProvider(): StaticMapAssetProvider {
  return {
    async render(request) {
      return renderStaticMapAsset(request);
    },
  };
}

/** Returns true when the rendered pixels contain only the neutral base layer. */
export function detectStaticMapBlank(pixels: Uint8Array): boolean {
  if (pixels.length === 0 || pixels.length % 3 !== 0) {
    throw new TypeError("static map pixels must contain RGB triplets");
  }
  for (let offset = 0; offset < pixels.length; offset += 3) {
    const color = `${pixels[offset]}:${pixels[offset + 1]}:${pixels[offset + 2]}`;
    if (!["244:246:248", "217:225:232", "205:213:221", "152:162:179"].includes(color)) return false;
  }
  return true;
}

function assertRenderRequest(request: StaticMapAssetRenderRequest): void {
  if (!request.assetId.trim()) throw new TypeError("static map assetId is required");
  if (!Number.isInteger(request.width) || request.width < 1 || request.width > MAX_LOGICAL_EDGE) {
    throw new RangeError(`static map width must be between 1 and ${MAX_LOGICAL_EDGE}`);
  }
  if (!Number.isInteger(request.height) || request.height < 1 || request.height > MAX_LOGICAL_EDGE) {
    throw new RangeError(`static map height must be between 1 and ${MAX_LOGICAL_EDGE}`);
  }
  if (request.pixelRatio !== 1 && request.pixelRatio !== 2) {
    throw new RangeError("static map pixelRatio must be 1 or 2");
  }
  if (!request.attribution.trim()) throw new TypeError("static map attribution is required");
  if (!Array.isArray(request.markers) || !Array.isArray(request.routes) || !Array.isArray(request.legend)) {
    throw new TypeError("static map marker, route and legend arrays are required");
  }
  for (const marker of request.markers) assertPoint(marker.point);
  for (const route of request.routeGeometries ?? []) {
    if (!route.id.trim() || route.coordinates.length < 2) {
      throw new TypeError("static map route geometry requires an id and two points");
    }
    route.coordinates.forEach(assertPoint);
  }
  for (const host of request.tilePolicy.allowedHosts) {
    if (!host.trim() || host.includes("/") || host.includes(" ")) {
      throw new TypeError("static map tile allowlist contains an invalid host");
    }
  }
  if (request.tilePolicy.mode === "allowlisted" && request.tilePolicy.allowedHosts.length === 0) {
    throw new TypeError("allowlisted static maps require at least one configured host");
  }
  if (request.bounds !== undefined && request.bounds !== null && !validBounds(request.bounds)) {
    throw new TypeError("static map bounds are invalid");
  }
}

function assertPoint(point: Wgs84Point): void {
  if (point.crs !== "WGS84" || !Number.isFinite(point.longitude) || !Number.isFinite(point.latitude)
    || point.longitude < -180 || point.longitude > 180 || point.latitude < -90 || point.latitude > 90) {
    throw new TypeError("static map coordinates must be finite WGS84 points");
  }
}

function fitBounds(points: readonly Wgs84Point[], requested: StaticMapBounds | null): StaticMapBounds | null {
  if (requested && validBounds(requested)) return requested;
  if (points.length === 0) return null;
  let west = Math.min(...points.map(({ longitude }) => longitude));
  let east = Math.max(...points.map(({ longitude }) => longitude));
  let south = Math.min(...points.map(({ latitude }) => latitude));
  let north = Math.max(...points.map(({ latitude }) => latitude));
  const longitudeSpan = east - west;
  const latitudeSpan = north - south;
  if (longitudeSpan > 300) {
    west = -180;
    east = 180;
  } else {
    const padding = Math.max(longitudeSpan * 0.12, 0.01);
    west = Math.max(-180, west - padding);
    east = Math.min(180, east + padding);
  }
  const latitudePadding = Math.max(latitudeSpan * 0.12, 0.01);
  south = Math.max(-90, south - latitudePadding);
  north = Math.min(90, north + latitudePadding);
  if (east - west < 0.02) {
    const center = (east + west) / 2;
    west = Math.max(-180, center - 0.01);
    east = Math.min(180, center + 0.01);
  }
  if (north - south < 0.02) {
    const center = (north + south) / 2;
    south = Math.max(-90, center - 0.01);
    north = Math.min(90, center + 0.01);
  }
  return { north, south, east, west };
}

function validBounds(bounds: StaticMapBounds): boolean {
  return Number.isFinite(bounds.north) && Number.isFinite(bounds.south)
    && Number.isFinite(bounds.east) && Number.isFinite(bounds.west)
    && bounds.north >= bounds.south && bounds.east >= bounds.west;
}

function project(point: Wgs84Point, bounds: StaticMapBounds | null, width: number, height: number): [number, number] | null {
  if (!bounds) return null;
  const longitudeSpan = Math.max(bounds.east - bounds.west, 0.000_001);
  const latitudeSpan = Math.max(bounds.north - bounds.south, 0.000_001);
  return [
    ((point.longitude - bounds.west) / longitudeSpan) * (width - 1),
    ((bounds.north - point.latitude) / latitudeSpan) * (height - 1),
  ];
}

function fill(pixels: Uint8Array, color: readonly [number, number, number]): void {
  for (let index = 0; index < pixels.length; index += 3) {
    pixels[index] = color[0];
    pixels[index + 1] = color[1];
    pixels[index + 2] = color[2];
  }
}

function drawGrid(pixels: Uint8Array, width: number, height: number, ratio: number): void {
  const columns = 8;
  const rows = 6;
  for (let column = 1; column < columns; column += 1) {
    const x = Math.round((width * column) / columns);
    for (let y = 0; y < height; y += 1) setPixel(pixels, width, x, y, GRID);
  }
  for (let row = 1; row < rows; row += 1) {
    const y = Math.round((height * row) / rows);
    for (let x = 0; x < width; x += 1) setPixel(pixels, width, x, y, GRID);
  }
  const center = Math.round(width / 2);
  drawLine(pixels, width, [center, 0], [center, height - 1], [205, 213, 221], Math.max(1, ratio), false);
}

function drawBorder(pixels: Uint8Array, width: number, height: number, ratio: number): void {
  drawLine(pixels, width, [0, 0], [width - 1, 0], BORDER, Math.max(1, ratio), false);
  drawLine(pixels, width, [width - 1, 0], [width - 1, height - 1], BORDER, Math.max(1, ratio), false);
  drawLine(pixels, width, [width - 1, height - 1], [0, height - 1], BORDER, Math.max(1, ratio), false);
  drawLine(pixels, width, [0, height - 1], [0, 0], BORDER, Math.max(1, ratio), false);
}

function drawPolyline(
  pixels: Uint8Array,
  width: number,
  height: number,
  bounds: StaticMapBounds | null,
  points: readonly Wgs84Point[],
  color: readonly [number, number, number],
  ratio: number,
  dashed: boolean,
): void {
  for (let index = 1; index < points.length; index += 1) {
    const from = project(points[index - 1]!, bounds, width, height);
    const to = project(points[index]!, bounds, width, height);
    if (from && to) drawLine(pixels, width, from, to, color, Math.max(2, ratio * 2), dashed);
  }
}

function drawMarker(
  pixels: Uint8Array,
  width: number,
  height: number,
  bounds: StaticMapBounds | null,
  marker: StaticMapMarkerManifest,
  ratio: number,
): void {
  const point = project(marker.point, bounds, width, height);
  if (!point) return;
  const color = parseColor(marker.color, DEFAULT_MARKER);
  drawCircle(pixels, width, point[0], point[1], Math.max(4, ratio * 5), [255, 255, 255]);
  drawCircle(pixels, width, point[0], point[1], Math.max(2, ratio * 3), color);
}

function drawLegend(
  pixels: Uint8Array,
  width: number,
  height: number,
  legend: readonly StaticMapLegendEntry[],
  ratio: number,
): void {
  const swatch = Math.max(4, ratio * 6);
  const y = Math.max(0, height - ratio * 16);
  legend.slice(0, 8).forEach((entry, index) => {
    const x = ratio * 8 + index * ratio * 20;
    const color = parseColor(entry.color, "#98a2b3");
    for (let offsetY = 0; offsetY < swatch; offsetY += 1) {
      for (let offsetX = 0; offsetX < swatch; offsetX += 1) setPixel(pixels, width, x + offsetX, y + offsetY, color);
    }
  });
}

function drawLine(
  pixels: Uint8Array,
  width: number,
  from: readonly [number, number],
  to: readonly [number, number],
  color: readonly [number, number, number],
  thickness: number,
  dashed: boolean,
): void {
  const distance = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
  const steps = Math.max(1, Math.ceil(distance));
  for (let step = 0; step <= steps; step += 1) {
    if (dashed && Math.floor(step / 5) % 2 === 1) continue;
    const x = from[0] + ((to[0] - from[0]) * step) / steps;
    const y = from[1] + ((to[1] - from[1]) * step) / steps;
    drawCircle(pixels, width, x, y, thickness / 2, color);
  }
}

function drawCircle(
  pixels: Uint8Array,
  width: number,
  centerX: number,
  centerY: number,
  radius: number,
  color: readonly [number, number, number],
): void {
  const minX = Math.floor(centerX - radius);
  const maxX = Math.ceil(centerX + radius);
  const minY = Math.floor(centerY - radius);
  const maxY = Math.ceil(centerY + radius);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) setPixel(pixels, width, x, y, color);
    }
  }
}

function setPixel(
  pixels: Uint8Array,
  width: number,
  x: number,
  y: number,
  color: readonly [number, number, number],
): void {
  const roundedX = Math.round(x);
  const roundedY = Math.round(y);
  const height = pixels.length / width / 3;
  if (roundedX < 0 || roundedY < 0 || roundedX >= width || roundedY >= height) return;
  const offset = (roundedY * width + roundedX) * 3;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
}

function parseColor(value: string, fallback: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{6}$/iu.test(value) ? value : fallback;
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
}

function encodePng(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const rowLength = width * 3;
  const scanlines = new Uint8Array((rowLength + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const scanlineOffset = row * (rowLength + 1);
    scanlines[scanlineOffset] = 0;
    scanlines.set(pixels.subarray(row * rowLength, (row + 1) * rowLength), scanlineOffset + 1);
  }
  const header = new Uint8Array(13);
  writeUint32(header, 0, width);
  writeUint32(header, 4, height);
  header[8] = 8;
  header[9] = 2;
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return concat(
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", new Uint8Array(deflateSync(scanlines))),
    pngChunk("IEND", new Uint8Array()),
  );
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const payload = concat(typeBytes, data);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(payload, 4);
  writeUint32(chunk, data.length + 8, crc32(payload));
  return chunk;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
