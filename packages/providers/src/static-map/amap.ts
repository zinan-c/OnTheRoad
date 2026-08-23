import { createHash } from "node:crypto";

import { gcj02ToWgs84, wgs84ToGcj02 } from "../coordinates/gcj02.js";
import type { Wgs84Point } from "../contracts/dto.js";
import {
  ProviderError,
  validateProviderAttribution,
} from "../contracts/errors.js";
import {
  assertStaticMapAssetManifest,
  type StaticMapAssetContentType,
  type StaticMapBounds,
} from "./manifest.js";
import {
  renderStaticMapAsset,
  type StaticMapAssetProvider,
  type StaticMapAssetRenderRequest,
  type StaticMapAssetRenderResult,
  type StaticMapRouteGeometry,
} from "./renderer.js";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_URL_LENGTH = 7_500;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_MARKERS = 50;
const MAX_ROUTE_POINTS = 400;

export type AmapStaticMapFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type AmapStaticMapProviderOptions = Readonly<{
  apiKey: string;
  baseUrl?: string | URL;
  timeoutMs?: number;
  attribution: string;
  fetch?: AmapStaticMapFetch;
  maxUrlLength?: number;
  maxResponseBytes?: number;
}>;

export function createAmapStaticMapAssetProvider(
  options: AmapStaticMapProviderOptions,
): StaticMapAssetProvider {
  const apiKey = options.apiKey.trim();
  const attribution = validateProviderAttribution(options.attribution);
  const baseUrl = parseBaseUrl(options.baseUrl ?? "https://restapi.amap.com/v3/staticmap");
  const timeoutMs = boundedInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 250, 30_000, "timeoutMs");
  const maxUrlLength = boundedInteger(options.maxUrlLength ?? DEFAULT_MAX_URL_LENGTH, 1_024, 12_000, "maxUrlLength");
  const maxResponseBytes = boundedInteger(options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, 1_024, 32 * 1024 * 1024, "maxResponseBytes");
  const request = options.fetch ?? fetch;

  return {
    async render(input) {
      if (!apiKey) return degraded(input, attribution, "AMAP_API_KEY is not configured");
      try {
        const url = buildStaticMapUrl(baseUrl, apiKey, input, maxUrlLength);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response: Response;
        try {
          response = await request(new URL(url), { signal: controller.signal });
        } catch (error) {
          if (controller.signal.aborted) throw new ProviderError("PROVIDER_TIMEOUT", "AMap static map request timed out", true, "staticMap");
          throw new ProviderError("PROVIDER_UNAVAILABLE", "AMap static map request failed", true, "staticMap");
        } finally {
          clearTimeout(timer);
        }
        if (!response.ok) throw responseError(response.status);
        const contentType = normalizeContentType(response.headers.get("content-type"));
        if (!contentType) throw new ProviderError("PROVIDER_RESPONSE_INVALID", "AMap static map response is not an image", true, "staticMap", { status: response.status, provider: "amap" });
        const declaredBytes = Number(response.headers.get("content-length"));
        if (Number.isFinite(declaredBytes) && declaredBytes > maxResponseBytes) {
          throw new ProviderError("PROVIDER_RESPONSE_INVALID", "AMap static map response size exceeds the configured bound", true, "staticMap", { status: response.status, provider: "amap" });
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength === 0 || bytes.byteLength > maxResponseBytes) {
          throw new ProviderError("PROVIDER_RESPONSE_INVALID", "AMap static map response size is invalid", true, "staticMap", { status: response.status, provider: "amap" });
        }
        return ready(input, bytes, contentType, attribution);
      } catch (error) {
        const reason = error instanceof ProviderError
          ? error.message
          : "AMap static map request failed";
        return degraded(input, attribution, reason);
      }
    },
  };
}

function ready(
  input: StaticMapAssetRenderRequest,
  bytes: Uint8Array,
  contentType: StaticMapAssetContentType,
  attribution: string,
): StaticMapAssetRenderResult {
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  const manifest = {
    assetId: input.assetId,
    scope: input.scope,
    contentType,
    status: "ready" as const,
    checksumSha256,
    width: input.width,
    height: input.height,
    pixelRatio: input.pixelRatio,
    bounds: boundsForRequest(input),
    markers: input.markers,
    routes: input.routes,
    legend: input.legend,
    attribution,
    degraded: false,
    degradationReason: null,
  };
  assertStaticMapAssetManifest(manifest);
  return { manifest, bytes };
}

function degraded(
  input: StaticMapAssetRenderRequest,
  attribution: string,
  reason: string,
): StaticMapAssetRenderResult {
  return renderStaticMapAsset({
    ...input,
    attribution,
    tilePolicy: { mode: "disabled", allowedHosts: [] },
    degradationReason: reason,
  });
}

function buildStaticMapUrl(
  baseUrl: URL,
  apiKey: string,
  input: StaticMapAssetRenderRequest,
  maxUrlLength: number,
): string {
  const markers = input.markers.slice(0, MAX_MARKERS);
  const routes = input.routeGeometries ?? [];
  let routeGeometries = routes.map((route) => simplifyRoute(route, MAX_ROUTE_POINTS));
  let url = buildUrl(baseUrl, apiKey, input, markers, routeGeometries);
  while (url.length > maxUrlLength && routeGeometries.some((route) => route.coordinates.length > 2)) {
    routeGeometries = routeGeometries.map((route) => simplifyRoute(route, Math.max(2, Math.floor(route.coordinates.length * 0.72))));
    url = buildUrl(baseUrl, apiKey, input, markers, routeGeometries);
  }
  if (url.length > maxUrlLength) throw new ProviderError("PROVIDER_REQUEST_INVALID", "AMap static map URL exceeds the configured bound", false, "staticMap");
  return url;
}

function buildUrl(
  baseUrl: URL,
  apiKey: string,
  input: StaticMapAssetRenderRequest,
  markers: readonly StaticMapAssetRenderRequest["markers"][number][],
  routes: readonly StaticMapRouteGeometry[],
): string {
  const center = centerForRequest(input);
  const gcjCenter = center ? wgs84ToGcj02(center) : null;
  const params = new URLSearchParams(baseUrl.search);
  params.set("key", apiKey);
  params.set("location", gcjCenter ? `${gcjCenter.longitude.toFixed(6)},${gcjCenter.latitude.toFixed(6)}` : "121.4737,31.2304");
  params.set("zoom", String(zoomForRequest(input)));
  params.set("size", `${Math.max(1, input.width * input.pixelRatio)},${Math.max(1, input.height * input.pixelRatio)}`);
  params.set("scale", String(input.pixelRatio));
  if (markers.length > 0) {
    params.set("markers", markers.map((marker) => {
      const point = wgs84ToGcj02(marker.point);
      return `mid,${colorToken(marker.color)},${encodeLabel(marker.label)}:${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`;
    }).join(";"));
  }
  if (routes.length > 0) {
    params.set("paths", routes.map((route) => {
      const color = colorToken(route.color);
      const points = route.coordinates.map((point) => {
        const gcj = wgs84ToGcj02(point);
        return `${gcj.longitude.toFixed(6)},${gcj.latitude.toFixed(6)}`;
      }).join(";");
      return `weight:5|color:${color}|${points}`;
    }).join("|"));
  }
  const url = new URL(baseUrl.href);
  url.search = params.toString();
  return url.href;
}

function simplifyRoute(route: StaticMapRouteGeometry, maxPoints: number): StaticMapRouteGeometry {
  const coordinates = route.coordinates.map((point) => wgs84ToGcj02(point));
  if (coordinates.length <= maxPoints) return { ...route, coordinates: coordinates.map(gcj02ToWgs84) };
  const step = (coordinates.length - 1) / (maxPoints - 1);
  const sampled = Array.from({ length: maxPoints }, (_, index) => coordinates[Math.round(index * step)]!).map(gcj02ToWgs84);
  return { ...route, coordinates: sampled };
}

function centerForRequest(input: StaticMapAssetRenderRequest): Wgs84Point | null {
  const bounds = boundsForRequest(input);
  if (bounds) {
    return {
      longitude: (bounds.west + bounds.east) / 2,
      latitude: (bounds.south + bounds.north) / 2,
      crs: "WGS84",
    };
  }
  return input.markers[0]?.point ?? input.routeGeometries?.[0]?.coordinates[0] ?? null;
}

function boundsForRequest(input: StaticMapAssetRenderRequest): StaticMapBounds | null {
  if (input.bounds) return input.bounds;
  const points = [
    ...input.markers.map(({ point }) => point),
    ...(input.routeGeometries ?? []).flatMap(({ coordinates }) => coordinates),
  ];
  if (points.length === 0) return null;
  const longitudes = points.map(({ longitude }) => longitude);
  const latitudes = points.map(({ latitude }) => latitude);
  const west = Math.min(...longitudes);
  const east = Math.max(...longitudes);
  const south = Math.min(...latitudes);
  const north = Math.max(...latitudes);
  const longitudePadding = Math.max((east - west) * 0.12, 0.01);
  const latitudePadding = Math.max((north - south) * 0.12, 0.01);
  return {
    west: Math.max(-180, west - longitudePadding),
    east: Math.min(180, east + longitudePadding),
    south: Math.max(-90, south - latitudePadding),
    north: Math.min(90, north + latitudePadding),
  };
}

function zoomForRequest(input: StaticMapAssetRenderRequest): number {
  const bounds = boundsForRequest(input);
  if (!bounds) return 4;
  const span = Math.max(bounds.east - bounds.west, bounds.north - bounds.south, 0.01);
  return Math.max(3, Math.min(18, Math.round(Math.log2(360 / span))));
}

function colorToken(value: string): string {
  const match = value.trim().match(/^#?([0-9a-f]{6})$/iu);
  return `0x${(match?.[1] ?? "155EEF").toUpperCase()}`;
}

function encodeLabel(value: string): string {
  return value.replace(/[;:|,]/gu, " ").slice(0, 40);
}

function normalizeContentType(value: string | null): StaticMapAssetContentType | null {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase();
  return normalized === "image/png" || normalized === "image/jpeg" || normalized === "image/webp"
    ? normalized
    : null;
}

function responseError(status: number): ProviderError {
  if (status === 401 || status === 403) return new ProviderError("PROVIDER_CREDENTIALS_INVALID", "AMap static map credentials were rejected", false, "staticMap", { status, provider: "amap" });
  if (status === 429) return new ProviderError("PROVIDER_RATE_LIMITED", "AMap static map rate limit exceeded", true, "staticMap", { status, provider: "amap" });
  if (status === 408 || status === 504) return new ProviderError("PROVIDER_TIMEOUT", "AMap static map request timed out", true, "staticMap", { status, provider: "amap" });
  return new ProviderError("PROVIDER_UNAVAILABLE", "AMap static map service was unavailable", true, "staticMap", { status, provider: "amap" });
}

function parseBaseUrl(value: string | URL): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ProviderError("PROVIDER_REQUEST_INVALID", "AMap static map base URL is invalid", false, "staticMap"); }
  if (url.protocol !== "https:") throw new ProviderError("PROVIDER_REQUEST_INVALID", "AMap static map base URL must use HTTPS", false, "staticMap");
  return url;
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new ProviderError("PROVIDER_REQUEST_INVALID", `AMap static map ${field} is invalid`, false, "staticMap");
  return value;
}
