import {
  gcj02ToWgs84,
  type Gcj02Point,
  wgs84ToGcj02,
} from "../coordinates/gcj02.js";
import type { RouteRequest, RouteResult, Wgs84Point } from "../contracts/dto.js";
import { ProviderError, validateProviderAttribution } from "../contracts/errors.js";
import { assertWgs84Point } from "../contracts/validation.js";

const ROUTE_PATHS = Object.freeze({
  walking: "v5/direction/walking",
  bicycling: "v5/direction/bicycling",
  driving: "v5/direction/driving",
  transit: "v5/direction/transit/integrated",
});

const DRIVING_MODES = new Set([
  "SELF_DRIVE",
  "TAXI",
  "RIDE_HAILING",
  "CHARTER_CAR",
  "BUS",
  "COACH",
  "SHUTTLE",
]);
const TRANSIT_MODES = new Set(["PUBLIC_BUS", "METRO", "LIGHT_RAIL"]);
const EXPLICIT_APPROXIMATE_MODES = new Set([
  "FLIGHT",
  "TRAIN",
  "HIGH_SPEED_RAIL",
  "SHIP",
  "PUBLIC_BOAT",
  "CHARTER_BOAT",
  "FERRY",
  "CABLE_CAR",
  "OTHER",
]);

export type DirectionsFetch = (url: URL, init?: RequestInit) => Promise<Response>;

export interface AmapDirectionsOptions {
  readonly apiKey: string;
  readonly baseUrl?: string | URL;
  readonly timeoutMs?: number;
  readonly drivingStrategy?: number;
  readonly attribution?: string;
  readonly fetch?: DirectionsFetch;
  /** Explicitly opt in to AMap motorcycle routing; absent means approximate. */
  readonly motorcycleEnabled?: boolean;
}

function endpoint(baseUrl: URL, path: string): URL {
  const base = baseUrl.href.endsWith("/") ? baseUrl.href : `${baseUrl.href}/`;
  return new URL(path.replace(/^\/+/, ""), base);
}

function providerError(
  code: ConstructorParameters<typeof ProviderError>[0],
  message: string,
  retryable: boolean,
  details: ConstructorParameters<typeof ProviderError>[4] = {},
): ProviderError {
  return new ProviderError(code, message, retryable, undefined, details);
}

function retryAfter(response: Response): number | undefined {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function routeCandidates(payload: unknown): readonly unknown[] {
  const route = object(object(payload).route);
  if (Array.isArray(route.paths)) return route.paths;
  if (Array.isArray(route.transits)) return route.transits;
  return [];
}

function collectPolylines(value: unknown, output: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectPolylines(entry, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const [key, child] of Object.entries(value)) {
    if (key === "polyline") {
      const polyline = text(child);
      if (polyline) output.push(polyline);
    } else if (key === "steps" || key === "segments" || key === "walking" || key === "buslines") {
      collectPolylines(child, output);
    }
  }
  return output;
}

function parsePolyline(value: string): Wgs84Point[] {
  const points: Wgs84Point[] = [];
  for (const pair of value.split(";")) {
    const [longitudeText, latitudeText] = pair.split(",");
    const longitude = Number(longitudeText);
    const latitude = Number(latitudeText);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    const gcj02: Gcj02Point = { longitude, latitude, crs: "GCJ02" };
    try {
      points.push(gcj02ToWgs84(gcj02));
    } catch {
      // A single malformed step is ignored; the complete route is validated
      // below and fails closed if fewer than two points remain.
    }
  }
  return points;
}

function mergeStepPolylines(polylines: readonly string[]): Wgs84Point[] {
  const merged: Wgs84Point[] = [];
  for (const polyline of polylines) {
    for (const point of parsePolyline(polyline)) {
      const previous = merged.at(-1);
      if (
        previous
        && Math.abs(previous.longitude - point.longitude) < 1e-9
        && Math.abs(previous.latitude - point.latitude) < 1e-9
      ) continue;
      merged.push(point);
    }
  }
  return merged;
}

function approximateRoute(request: RouteRequest, attribution: string): RouteResult {
  return {
    kind: "approximate",
    mode: request.mode,
    geometry: { type: "LineString", coordinates: [request.from, request.to] },
    attribution,
  };
}

function routePath(mode: string, motorcycleEnabled: boolean): string | null {
  if (mode === "WALK") return ROUTE_PATHS.walking;
  if (mode === "BICYCLE") return ROUTE_PATHS.bicycling;
  if (DRIVING_MODES.has(mode) || (mode === "MOTORCYCLE" && motorcycleEnabled)) return ROUTE_PATHS.driving;
  if (TRANSIT_MODES.has(mode)) return ROUTE_PATHS.transit;
  return null;
}

function normalizePayload(value: unknown): Record<string, unknown> {
  const payload = object(value);
  if (String(payload.status ?? "") !== "1") {
    const code = text(payload.infocode);
    if (["10001", "10002", "10003", "10009"].includes(code ?? "")) {
      throw providerError("PROVIDER_CREDENTIALS_INVALID", "AMAP credentials were rejected", false, {
        provider: "amap",
      });
    }
    if (["10004", "10021", "10044"].includes(code ?? "")) {
      throw providerError("PROVIDER_RATE_LIMITED", "AMAP rate limit reached", true, {
        provider: "amap",
      });
    }
    throw providerError("PROVIDER_UNAVAILABLE", "AMAP returned an unsuccessful response", true, {
      provider: "amap",
    });
  }
  return payload;
}

function assertRouteGeometry(payload: unknown): RouteResult["geometry"] {
  for (const route of routeCandidates(payload)) {
    const geometry = mergeStepPolylines(collectPolylines(route));
    if (geometry.length >= 2) {
      return { type: "LineString", coordinates: geometry };
    }
  }
  throw providerError("PROVIDER_RESPONSE_INVALID", "AMAP route geometry is invalid", false, {
    provider: "amap",
  });
}

export function createAmapDirectionsProvider(options: AmapDirectionsOptions): {
  readonly provider: "amap";
  readonly route: (request: RouteRequest) => Promise<RouteResult>;
} {
  if (!options.apiKey.trim()) {
    throw providerError("PROVIDER_CREDENTIALS_MISSING", "AMAP API key is required", false, {
      provider: "amap",
    });
  }
  const baseUrl = new URL(options.baseUrl ?? "https://restapi.amap.com/");
  if (baseUrl.protocol !== "https:") {
    throw providerError("PROVIDER_REQUEST_INVALID", "AMAP Directions endpoint must use HTTPS", false, {
      provider: "amap",
    });
  }
  const attribution = validateProviderAttribution(options.attribution ?? "© 高德地图");
  const fetcher = options.fetch ?? (globalThis.fetch as DirectionsFetch);
  const timeoutMs = options.timeoutMs ?? 8_000;
  const drivingStrategy = options.drivingStrategy ?? 0;
  const motorcycleEnabled = options.motorcycleEnabled === true;

  async function fetchDirections(path: string, requestInput: RouteRequest): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const url = endpoint(baseUrl, path);
    url.searchParams.set("key", options.apiKey);
    const origin = wgs84ToGcj02(requestInput.from);
    const destination = wgs84ToGcj02(requestInput.to);
    url.searchParams.set("origin", `${origin.longitude},${origin.latitude}`);
    url.searchParams.set("destination", `${destination.longitude},${destination.latitude}`);
    url.searchParams.set("show_fields", "polyline");
    if (path === ROUTE_PATHS.driving) url.searchParams.set("strategy", String(drivingStrategy));
    if (path === ROUTE_PATHS.transit) {
      if (!requestInput.city?.trim() || !requestInput.cityd?.trim()) {
        throw providerError("PROVIDER_REQUEST_INVALID", "AMAP transit city context is required", false, {
          provider: "amap",
        });
      }
      url.searchParams.set("city", requestInput.city);
      url.searchParams.set("cityd", requestInput.cityd);
    }
    try {
      const response = await fetcher(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw providerError("PROVIDER_CREDENTIALS_INVALID", "AMAP credentials were rejected", false, {
          status: response.status,
          provider: "amap",
        });
      }
      if (response.status === 429) {
        const retryAfterSeconds = retryAfter(response);
        throw providerError("PROVIDER_RATE_LIMITED", "AMAP rate limit reached", true, {
          status: 429,
          provider: "amap",
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        });
      }
      if (!response.ok) {
        if (response.status === 408 || response.status === 504) {
          throw providerError("PROVIDER_TIMEOUT", "AMAP Directions request timed out", true, {
            status: response.status,
            provider: "amap",
          });
        }
        throw providerError("PROVIDER_UNAVAILABLE", "AMAP Directions request failed", response.status >= 500, {
          status: response.status,
          provider: "amap",
        });
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw providerError("PROVIDER_RESPONSE_INVALID", "AMAP Directions returned invalid JSON", false, {
          provider: "amap",
        });
      }
      return normalizePayload(payload);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (controller.signal.aborted) {
        throw providerError("PROVIDER_TIMEOUT", "AMAP Directions request timed out", true, {
          provider: "amap",
        });
      }
      throw providerError("PROVIDER_UNAVAILABLE", "AMAP Directions transport failed", true, {
        provider: "amap",
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    provider: "amap",
    async route(request) {
      assertWgs84Point(request.from);
      assertWgs84Point(request.to);
      const mode = request.mode.trim().toUpperCase();
      if (mode === "MOTORCYCLE" && !motorcycleEnabled) return approximateRoute(request, attribution);
      if (EXPLICIT_APPROXIMATE_MODES.has(mode)) return approximateRoute(request, attribution);
      const path = routePath(mode, motorcycleEnabled);
      if (!path) return approximateRoute(request, attribution);
      const payload = await fetchDirections(path, request);
      const geometry = assertRouteGeometry(payload);
      return { kind: "resolved", mode: request.mode, geometry, attribution };
    },
  };
}
