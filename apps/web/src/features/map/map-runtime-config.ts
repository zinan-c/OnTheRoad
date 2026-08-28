import type { MapLayerId, MapClientProvider } from "@on-the-road/config/env";
import { loadAMapRuntime, type AMapNamespace } from "./amap-runtime";
import { loadMapLibreRuntime } from "./maplibre-runtime.mjs";
import { TRIP_MAP_RUNTIME_OPTIONS } from "./map-runtime-options";
import type { MapRuntimeFactory } from "./maplibre-wrapper";

export type MapLayerCatalogEntry = {
  readonly id: MapLayerId;
  readonly label: string;
  readonly provider: "amap" | "mapbox" | "fixture";
  readonly engine: "amap-js" | "maplibre";
  readonly attribution: string;
  readonly enabled: boolean;
};

export const AMAP_LAYER_CATALOG: readonly MapLayerCatalogEntry[] = [
  { id: "amap-street", label: "标准地图", provider: "amap", engine: "amap-js", attribution: "© 高德地图", enabled: true },
  { id: "amap-satellite", label: "卫星影像", provider: "amap", engine: "amap-js", attribution: "© 高德地图", enabled: true },
  { id: "amap-satellite-labels", label: "卫星+路网", provider: "amap", engine: "amap-js", attribution: "© 高德地图", enabled: true },
];

export const MAPBOX_LAYER_CATALOG: readonly MapLayerCatalogEntry[] = [
  {
    id: "mapbox-streets",
    label: "Mapbox 街道",
    provider: "mapbox",
    engine: "maplibre",
    attribution: "© Mapbox © OpenStreetMap contributors",
    enabled: true,
  },
];

export const MAP_LAYER_CATALOG: readonly MapLayerCatalogEntry[] = [
  ...AMAP_LAYER_CATALOG,
  ...MAPBOX_LAYER_CATALOG,
];

export type MapRuntimeConfig = {
  readonly provider: MapClientProvider;
  readonly engine: "maplibre" | "amap-js";
  readonly jsApiKey?: string;
  readonly securityJsCode?: string;
  readonly mapboxPublicToken?: string;
  readonly tileTemplate?: string;
  readonly tileSize?: number;
  readonly maxZoom?: number;
  readonly showMapboxLogo?: boolean;
  readonly defaultLayer: MapLayerId;
  readonly attribution: string;
  readonly layers?: readonly MapLayerCatalogEntry[];
};

export type ConfiguredMapRuntime = MapRuntimeFactory & {
  readonly mapConfig: MapRuntimeConfig;
};

export function mapLibreRuntimeOptions(config: MapRuntimeConfig) {
  return {
    ...TRIP_MAP_RUNTIME_OPTIONS,
    ...(config.tileTemplate ? { tileTemplate: config.tileTemplate } : {}),
    ...(config.tileSize ? { tileSize: config.tileSize } : {}),
    ...(config.maxZoom !== undefined ? { maxZoom: config.maxZoom } : {}),
    ...(config.showMapboxLogo ? { showMapboxLogo: true } : {}),
    attribution: config.provider === "fixture"
      ? TRIP_MAP_RUNTIME_OPTIONS.attribution
      : config.attribution,
  };
}

export async function fetchMapRuntimeConfig(
  request: typeof fetch = fetch,
): Promise<MapRuntimeConfig> {
  const response = await request("/api/map/config", { cache: "no-store" });
  if (!response.ok) throw new Error("Map configuration is unavailable");
  const payload = await response.json() as Partial<MapRuntimeConfig>;
  if ((payload.provider !== "fixture" && payload.provider !== "amap" && payload.provider !== "mapbox")
    || (payload.engine !== "maplibre" && payload.engine !== "amap-js")
    || typeof payload.defaultLayer !== "string"
    || !MAP_LAYER_CATALOG.some(({ id }) => id === payload.defaultLayer)
    || typeof payload.attribution !== "string") {
    throw new Error("Map configuration is invalid");
  }
  if (payload.provider === "mapbox"
    && (payload.engine !== "maplibre"
      || typeof payload.mapboxPublicToken !== "string"
      || typeof payload.tileTemplate !== "string"
      || payload.tileSize !== 512
      || typeof payload.maxZoom !== "number"
      || payload.maxZoom < 0
      || payload.maxZoom > 22
      || payload.showMapboxLogo !== true
      || !MAPBOX_LAYER_CATALOG.some(({ id }) => id === payload.defaultLayer))) {
    throw new Error("Mapbox map configuration is invalid");
  }
  return payload as MapRuntimeConfig;
}

export async function loadConfiguredMapRuntime(options: {
  readonly config?: MapRuntimeConfig;
  readonly request?: typeof fetch;
  readonly amap?: AMapNamespace;
  readonly scriptLoader?: (config: MapRuntimeConfig) => Promise<AMapNamespace>;
} = {}): Promise<ConfiguredMapRuntime> {
  const config = options.config ?? await fetchMapRuntimeConfig(options.request ?? fetch);
  let runtime: MapRuntimeFactory;
  if (config.provider === "amap") {
    const amapOptions: {
      readonly config: MapRuntimeConfig;
      readonly amap?: AMapNamespace;
      readonly scriptLoader?: (config: MapRuntimeConfig) => Promise<AMapNamespace>;
    } = { config };
    if (options.amap) Object.assign(amapOptions, { amap: options.amap });
    if (options.scriptLoader) Object.assign(amapOptions, { scriptLoader: options.scriptLoader });
    runtime = await loadAMapRuntime(amapOptions);
  } else {
    runtime = await loadMapLibreRuntime(mapLibreRuntimeOptions(config)) as unknown as MapRuntimeFactory;
  }
  return Object.assign(runtime, { mapConfig: config }) as ConfiguredMapRuntime;
}
