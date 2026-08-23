import {
  gcj02ToWgs84,
  wgs84ToGcj02,
  type Gcj02Point,
} from "@on-the-road/providers/coordinates";
import type { MapLayerId } from "@on-the-road/config/env";
import type { MapRuntimeFactory, MapRuntimeHandle, MapRuntimeOptions } from "./maplibre-wrapper";
import type { MapRuntimeConfig } from "./map-runtime-config";
import type { MapMarker } from "./map-model";

type AMapLngLat = {
  readonly lng?: number;
  readonly lat?: number;
  getLng?: () => number;
  getLat?: () => number;
};

type AMapEvent = {
  readonly lnglat?: AMapLngLat;
  readonly originalEvent?: { readonly pointerType?: string; readonly touches?: unknown };
};

type AMapInstance = {
  on: (event: string, handler: (event: AMapEvent) => void) => void;
  add?: (layers: unknown | readonly unknown[]) => void;
  remove?: (layers: unknown | readonly unknown[]) => void;
  setLayers?: (layers: readonly unknown[]) => void;
  setBounds?: (bounds: unknown) => void;
  setFitView?: (overlays?: readonly unknown[], immediately?: boolean, avoid?: readonly number[], maxZoom?: number) => void;
  resize?: () => void;
  destroy?: () => void;
};

type AMapMarkerInstance = {
  on: (event: string, handler: (event: AMapEvent) => void) => void;
  getPosition?: () => AMapLngLat;
  setMap?: (map: AMapInstance | null) => void;
  setPosition?: (position: readonly [number, number]) => void;
  setOffset?: (offset: unknown) => void;
};

type AMapPolylineInstance = {
  on?: (event: string, handler: (event: AMapEvent) => void) => void;
  setMap?: (map: AMapInstance | null) => void;
};

export type AMapNamespace = {
  readonly Map: new (container: unknown, options?: Record<string, unknown>) => AMapInstance;
  readonly Marker: new (options: Record<string, unknown>) => AMapMarkerInstance;
  readonly Polyline: new (options: Record<string, unknown>) => AMapPolylineInstance;
  readonly TileLayer?: {
    new (options?: Record<string, unknown>): unknown;
    Satellite?: new (options?: Record<string, unknown>) => unknown;
    RoadNet?: new (options?: Record<string, unknown>) => unknown;
  };
  readonly Bounds?: new (southWest: unknown, northEast: unknown) => unknown;
  readonly LngLat?: new (longitude: number, latitude: number) => unknown;
  readonly TileLayerSatellite?: new (options?: Record<string, unknown>) => unknown;
  readonly TileLayerRoadNet?: new (options?: Record<string, unknown>) => unknown;
};

type RuntimeOptions = {
  readonly config: MapRuntimeConfig;
  readonly amap?: AMapNamespace;
  readonly scriptLoader?: (config: MapRuntimeConfig) => Promise<AMapNamespace>;
};

export async function loadAMapRuntime(options: RuntimeOptions): Promise<MapRuntimeFactory> {
  if (options.config.provider !== "amap") throw new Error("AMap runtime requires the amap provider");
  if (!options.config.jsApiKey || !options.config.securityJsCode) {
    throw new Error("AMap JS credentials are unavailable");
  }
  const amap = options.amap
    ?? (options.scriptLoader ? await options.scriptLoader(options.config) : await loadAMapScript(options.config));
  return createAMapRuntime(amap, options.config);
}

export function createAMapRuntime(amap: AMapNamespace, config: MapRuntimeConfig): MapRuntimeFactory {
  if (config.provider !== "amap") throw new Error("AMap runtime requires the amap provider");
  return {
    createMap(options: MapRuntimeOptions): MapRuntimeHandle {
      const map = new amap.Map(options.container, {
        viewMode: "2D",
        zoom: 4,
        center: [121.4737, 31.2304],
        resizeEnable: true,
      });
      let markers: AMapMarkerInstance[] = [];
      let polylines: AMapPolylineInstance[] = [];
      let selectedItemId: string | null = null;
      let currentLayer: MapLayerId = config.defaultLayer;
      let markerModels: readonly MapMarker[] = [];

      map.on("error", (event) => options.onTileError(asError(event)));
      map.on("click", (event) => {
        const point = eventPoint(event.lnglat);
        if (point) options.onMapClick?.(gcj02ToWgs84(point));
      });

      const renderMarkers = () => {
        markers.forEach((marker) => marker.setMap?.(null));
        markers = markerModels.map((model) => {
          const point = wgs84ToGcj02({ longitude: model.coordinate[0], latitude: model.coordinate[1], crs: "WGS84" });
          const element = document.createElement("button");
          element.type = "button";
          element.className = "otr-amap-marker";
          element.textContent = String(model.daySequence);
          element.setAttribute("aria-label", model.tooltip);
          element.setAttribute("data-item-id", model.itemId);
          element.title = model.tooltip;
          element.addEventListener("click", () => options.onMarkerClick?.(model.itemId));
          const marker = new amap.Marker({
            map,
            position: [point.longitude, point.latitude],
            content: element,
            draggable: Boolean(options.draggableMarkers),
            offset: model.offset ? { x: model.offset[0], y: model.offset[1] } : undefined,
          });
          marker.on("dragend", (event) => {
            const dragged = eventPoint(event.lnglat ?? marker.getPosition?.());
            if (!dragged) return;
            const inputMode = event.originalEvent?.pointerType === "touch" || event.originalEvent?.touches
              ? "touch"
              : "mouse";
            options.onMarkerDragEnd?.(model.itemId, gcj02ToWgs84(dragged), inputMode);
          });
          applySelected(marker, model.itemId, selectedItemId);
          return marker;
        });
      };

      const setLayer = (layer: MapLayerId) => {
        currentLayer = layer;
        const layers = createLayers(amap, layer);
        if (map.setLayers) map.setLayers(layers);
        else {
          map.add?.(layers);
        }
      };

      setLayer(currentLayer);

      return {
        setBaseLayer(layer) { setLayer(layer); },
        setGeoJson() {
          // AMap uses native Marker instances for the same WGS84 marker model;
          // setMarkers is the single overlay owner for both runtimes.
        },
        setMarkers(next) {
          markerModels = next;
          renderMarkers();
        },
        setRouteGeoJson(geojson) {
          polylines.forEach((line) => line.setMap?.(null));
          polylines = extractLineStrings(geojson).map((line) => {
            const path = line.coordinates.map(([longitude, latitude]) => {
              const point = wgs84ToGcj02({ longitude, latitude, crs: "WGS84" });
              return [point.longitude, point.latitude] as const;
            });
            const polyline = new amap.Polyline({
              map,
              path,
              strokeColor: line.color,
              strokeWeight: line.selected ? 7 : 5,
              strokeOpacity: 0.85,
            });
            polyline.on?.("click", () => options.onRouteClick?.(line.id));
            return polyline;
          });
        },
        setSelectedItem(itemId) {
          selectedItemId = itemId;
          markers.forEach((marker, index) => {
            const model = markerModels[index];
            if (model) applySelected(marker, model.itemId, selectedItemId);
          });
        },
        fitBounds(bounds, fitOptions) {
          const southwest = wgs84ToGcj02({ longitude: bounds[0][0], latitude: bounds[0][1], crs: "WGS84" });
          const northeast = wgs84ToGcj02({ longitude: bounds[1][0], latitude: bounds[1][1], crs: "WGS84" });
          const converted = createBounds(amap, southwest, northeast);
          if (map.setBounds) map.setBounds(converted);
          else map.setFitView?.(markers, false, [fitOptions.padding, fitOptions.padding, fitOptions.padding, fitOptions.padding], fitOptions.maxZoom);
        },
        resize() { map.resize?.(); },
        destroy() {
          markers.forEach((marker) => marker.setMap?.(null));
          polylines.forEach((line) => line.setMap?.(null));
          map.destroy?.();
        },
      };
    },
  };
}

async function loadAMapScript(config: MapRuntimeConfig): Promise<AMapNamespace> {
  const globalObject = globalThis as typeof globalThis & {
    AMap?: AMapNamespace;
    _AMapSecurityConfig?: { securityJsCode: string };
  };
  if (globalObject.AMap) return globalObject.AMap;
  if (typeof document === "undefined") throw new Error("AMap JS requires a browser document");
  globalObject._AMapSecurityConfig = { securityJsCode: config.securityJsCode! };
  const callback = `__otr_amap_${Math.random().toString(36).slice(2)}`;
  const namespace = await new Promise<AMapNamespace>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      delete (globalObject as unknown as Record<string, unknown>)[callback];
      reject(new Error("AMap JS script timed out"));
    }, 15_000);
    (globalObject as unknown as Record<string, unknown>)[callback] = () => {
      window.clearTimeout(timeout);
      delete (globalObject as unknown as Record<string, unknown>)[callback];
      if (globalObject.AMap) resolve(globalObject.AMap);
      else reject(new Error("AMap JS namespace is unavailable"));
    };
    const script = document.createElement("script");
    script.async = true;
    script.onerror = () => {
      window.clearTimeout(timeout);
      delete (globalObject as unknown as Record<string, unknown>)[callback];
      reject(new Error("AMap JS script failed to load"));
    };
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.jsApiKey!)}&callback=${encodeURIComponent(callback)}`;
    document.head.append(script);
  });
  return namespace;
}

function createLayers(amap: AMapNamespace, layer: MapLayerId): unknown[] {
  if (layer === "amap-street") return amap.TileLayer ? [new amap.TileLayer({})] : [];
  const satelliteCtor = amap.TileLayer?.Satellite ?? amap.TileLayerSatellite;
  const roadNetCtor = amap.TileLayer?.RoadNet ?? amap.TileLayerRoadNet;
  const layers: unknown[] = satelliteCtor ? [new satelliteCtor({})] : [];
  if (layer === "amap-satellite-labels" && roadNetCtor) layers.push(new roadNetCtor({}) );
  return layers;
}

function createBounds(amap: AMapNamespace, southwest: Gcj02Point, northeast: Gcj02Point): unknown {
  const sw = amap.LngLat ? new amap.LngLat(southwest.longitude, southwest.latitude) : [southwest.longitude, southwest.latitude];
  const ne = amap.LngLat ? new amap.LngLat(northeast.longitude, northeast.latitude) : [northeast.longitude, northeast.latitude];
  return amap.Bounds ? new amap.Bounds(sw, ne) : [sw, ne];
}

function eventPoint(value: AMapLngLat | undefined): Gcj02Point | null {
  if (!value) return null;
  const longitude = value.getLng?.() ?? value.lng;
  const latitude = value.getLat?.() ?? value.lat;
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    ? { longitude: longitude!, latitude: latitude!, crs: "GCJ02" }
    : null;
}

function applySelected(marker: AMapMarkerInstance, itemId: string, selectedItemId: string | null): void {
  const element = (marker as unknown as { getContent?: () => HTMLElement }).getContent?.();
  element?.classList.toggle("is-selected", itemId === selectedItemId || itemId.startsWith(`${selectedItemId}:`));
}

function extractLineStrings(value: unknown): readonly {
  readonly id: string;
  readonly color: string;
  readonly selected: boolean;
  readonly coordinates: readonly (readonly [number, number])[];
}[] {
  if (!value || typeof value !== "object") return [];
  const features = Array.isArray((value as { features?: unknown }).features)
    ? (value as { features: unknown[] }).features
    : [];
  return features.flatMap((feature) => {
    const geometry = feature && typeof feature === "object" ? (feature as { geometry?: unknown }).geometry : null;
    if (!geometry || typeof geometry !== "object") return [];
    const type = (geometry as { type?: unknown }).type;
    const coordinates = (geometry as { coordinates?: unknown }).coordinates;
    if (type !== "LineString" || !Array.isArray(coordinates)) return [];
    const properties = feature && typeof feature === "object" ? (feature as { properties?: unknown }).properties : null;
    const props = properties && typeof properties === "object" ? properties as Record<string, unknown> : {};
    const id = feature && typeof feature === "object" && (typeof (feature as { id?: unknown }).id === "string" || typeof (feature as { id?: unknown }).id === "number")
      ? String((feature as { id: string | number }).id)
      : `route-${features.indexOf(feature)}`;
    return [{
      id,
      color: typeof props.color === "string" ? props.color : "#2563EB",
      selected: props.selected === true,
      coordinates: coordinates.filter((point): point is [number, number] => Array.isArray(point)
        && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])),
    }];
  });
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error("AMap basemap unavailable");
}
