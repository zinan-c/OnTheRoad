import type { MapLayerId, MapClientProvider } from "@on-the-road/config/env";
import { loadAMapRuntime, type AMapNamespace } from "./amap-runtime";
import { loadMapLibreRuntime } from "./maplibre-runtime.mjs";
import { TRIP_MAP_RUNTIME_OPTIONS } from "./map-runtime-options";
import type { MapRuntimeFactory } from "./maplibre-wrapper";

export type MapLayerCatalogEntry = {
  readonly id: MapLayerId;
  readonly label: string;
  readonly provider: "amap";
  readonly engine: "amap-js";
  readonly attribution: string;
  readonly enabled: boolean;
};

export const AMAP_LAYER_CATALOG: readonly MapLayerCatalogEntry[] = [
  { id: "amap-street", label: "标准地图", provider: "amap", engine: "amap-js", attribution: "© 高德地图", enabled: true },
  { id: "amap-satellite", label: "卫星影像", provider: "amap", engine: "amap-js", attribution: "© 高德地图", enabled: true },
  { id: "amap-satellite-labels", label: "卫星+路网", provider: "amap", engine: "amap-js", attribution: "© 高德地图", enabled: true },
];

export type MapRuntimeConfig = {
  readonly provider: MapClientProvider;
  readonly engine: "maplibre" | "amap-js";
  readonly jsApiKey?: string;
  readonly securityJsCode?: string;
  readonly defaultLayer: MapLayerId;
  readonly attribution: string;
  readonly layers?: readonly MapLayerCatalogEntry[];
};

export type ConfiguredMapRuntime = MapRuntimeFactory & {
  readonly mapConfig: MapRuntimeConfig;
};

export async function fetchMapRuntimeConfig(
  request: typeof fetch = fetch,
): Promise<MapRuntimeConfig> {
  const response = await request("/api/map/config", { cache: "no-store" });
  if (!response.ok) throw new Error("Map configuration is unavailable");
  const payload = await response.json() as Partial<MapRuntimeConfig>;
  if ((payload.provider !== "fixture" && payload.provider !== "amap")
    || (payload.engine !== "maplibre" && payload.engine !== "amap-js")
    || typeof payload.defaultLayer !== "string"
    || !AMAP_LAYER_CATALOG.some(({ id }) => id === payload.defaultLayer)
    || typeof payload.attribution !== "string") {
    throw new Error("Map configuration is invalid");
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
    runtime = await loadMapLibreRuntime(TRIP_MAP_RUNTIME_OPTIONS) as unknown as MapRuntimeFactory;
  }
  return Object.assign(runtime, { mapConfig: config }) as ConfiguredMapRuntime;
}
