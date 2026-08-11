import {
  buildMapModel,
  type Bounds,
  type MapFilter,
  type MapItem,
  type MapMarker,
  type MapModel,
} from "./map-model";

export type MapRuntimeOptions = {
  container: unknown;
  onTileError: (error: Error) => void;
  onMarkerClick?: (itemId: string) => void;
  onRouteClick?: (routeId: string) => void;
  onMapClick?: (point: { longitude: number; latitude: number; crs: "WGS84" }) => void;
  onMarkerDragEnd?: (itemId: string, point: { longitude: number; latitude: number; crs: "WGS84" }, inputMode: "mouse" | "touch") => void;
  draggableMarkers?: boolean;
};

export type MapRuntimeHandle = {
  setGeoJson: (geojson: MapModel["geojson"]) => void;
  setMarkers: (markers: readonly MapMarker[]) => void;
  setRouteGeoJson: (geojson: unknown) => void;
  setSelectedItem?: (itemId: string | null) => void;
  fitBounds: (bounds: Bounds, options: { padding: number; maxZoom: number }) => void;
  resize: () => void;
  destroy: () => void;
};

export type MapRuntimeFactory = {
  createMap: (options: MapRuntimeOptions) => MapRuntimeHandle | Promise<MapRuntimeHandle>;
};

export type MapShellState = {
  mode: "map" | "neutral-grid" | "empty";
  mapAvailable: boolean;
  textEditingAvailable: true;
  markerCount: number;
  markers: readonly MapMarker[];
  legend: MapModel["legend"];
  invalidItemIds: readonly string[];
  unresolvedItemIds: readonly string[];
  degradationReason?: string;
  attribution: string;
  fullscreen: boolean;
  fit: MapModel["fit"];
  filter: MapFilter;
};

const ATTRIBUTION = "地图数据 © On The Road fixture";

export class MapLibreWrapper {
  private runtimeHandle: MapRuntimeHandle | undefined;
  private items: readonly MapItem[] = [];

  state: MapShellState = {
    mode: "empty",
    mapAvailable: false,
    textEditingAvailable: true,
    markerCount: 0,
    markers: [],
    legend: [],
    invalidItemIds: [],
    unresolvedItemIds: [],
    attribution: ATTRIBUTION,
    fullscreen: false,
    fit: {
      kind: "empty",
      bounds: null,
      message: "无有效坐标：请先确认地点",
    },
    filter: { kind: "all" },
  };

  constructor(private readonly runtime: MapRuntimeFactory) {}

  setRouteGeoJson(geojson: unknown): void {
    this.runtimeHandle?.setRouteGeoJson(geojson);
  }

  selectItem(itemId: string | null): void {
    this.runtimeHandle?.setSelectedItem?.(itemId);
  }

  async mount(
    container: unknown,
    items: readonly MapItem[],
    filter: MapFilter = { kind: "all" },
    onMarkerClick?: (itemId: string) => void,
    onRouteClick?: (routeId: string) => void,
  ): Promise<void> {
    this.items = [...items];
    const model = buildMapModel(this.items, filter);
    this.applyModelToState(model);

    if (model.fit.kind === "empty") {
      this.state = { ...this.state, mode: "empty", mapAvailable: false };
      return;
    }

    try {
      const mapOptions: MapRuntimeOptions = { container, onTileError: () => {
        this.state = { ...this.state, mode: "neutral-grid", degradationReason: "底图不可用" };
      } };
      if (onMarkerClick) mapOptions.onMarkerClick = onMarkerClick;
      if (onRouteClick) mapOptions.onRouteClick = onRouteClick;
      const handle = await this.runtime.createMap(mapOptions);
      this.runtimeHandle = handle;
      handle.setGeoJson(model.geojson);
      handle.setMarkers(model.markers);
      handle.fitBounds(model.fit.bounds, { padding: 48, maxZoom: 14 });
      this.state = { ...this.state, mode: "map", mapAvailable: true };
    } catch {
      this.runtimeHandle = undefined;
      this.state = {
        ...this.state,
        mode: "neutral-grid",
        mapAvailable: false,
        degradationReason: "WebGL 不可用",
      };
    }
  }

  setFilter(filter: MapFilter): void {
    this.updateItems(this.items, filter);
  }

  updateItems(items: readonly MapItem[], filter: MapFilter = this.state.filter): void {
    this.items = [...items];
    const model = buildMapModel(this.items, filter);
    this.applyModelToState(model);
    if (!this.runtimeHandle) return;
    this.runtimeHandle.setGeoJson(model.geojson);
    this.runtimeHandle.setMarkers(model.markers);
    if (model.fit.bounds) {
      this.runtimeHandle.fitBounds(model.fit.bounds, { padding: 48, maxZoom: 14 });
    }
  }

  resize(): void {
    this.runtimeHandle?.resize();
  }

  enterFullscreen(): void {
    this.state = { ...this.state, fullscreen: true };
    this.runtimeHandle?.resize();
  }

  exitFullscreen(): void {
    this.state = { ...this.state, fullscreen: false };
    this.runtimeHandle?.resize();
  }

  handleKey(key: string): boolean {
    if (key !== "Escape" || !this.state.fullscreen) return false;
    this.exitFullscreen();
    return true;
  }

  destroy(): void {
    this.runtimeHandle?.destroy();
    this.runtimeHandle = undefined;
  }

  private applyModelToState(model: MapModel): void {
    this.state = {
      ...this.state,
      markerCount: model.markers.length,
      markers: model.markers,
      legend: model.legend,
      invalidItemIds: model.invalidItemIds,
      unresolvedItemIds: model.unresolvedItemIds,
      fit: model.fit,
      filter: model.filter,
    };
  }
}

export function renderMapShell(state: MapShellState): string {
  const degradation = state.degradationReason
    ? `<p role="status">${escapeHtml(state.degradationReason)}；地图不可用不影响文字行程编辑</p>`
    : "";
  const empty = state.fit.kind === "empty"
    ? `<p role="status">${escapeHtml(state.fit.message)}</p>`
    : "";
  const grid = state.mode === "neutral-grid"
    ? `<div class="otr-map-grid" aria-label="中性网格"></div>`
    : "";
  const markers = state.markers.map((marker) => `
    <button class="otr-map-marker" style="--day-color:${escapeHtml(marker.dayColor)}"
      aria-label="${escapeHtml(marker.markerLabel)}" title="${escapeHtml(marker.tooltip)}">
      <span aria-hidden="true">${marker.daySequence}</span>
      <span class="otr-map-tooltip">${escapeHtml(marker.tooltip)}</span>
    </button>`).join("");
  const legend = state.legend.map((item) =>
    `<li><span style="--day-color:${escapeHtml(item.color)}"></span>${escapeHtml(item.label)}</li>`
  ).join("");

  return `<section class="otr-map-shell${state.fullscreen ? " is-fullscreen" : ""}" aria-label="行程地图">
    <nav aria-label="地图筛选">
      <button data-map-filter="all">全部</button>
      <button data-map-filter="day">按 Day</button>
      <button data-map-filter="destination">按目的地</button>
    </nav>
    <button data-map-fullscreen="${state.fullscreen ? "exit" : "enter"}">
      ${state.fullscreen ? "退出全屏" : "进入全屏"}
    </button>
    ${degradation}${empty}${grid}
    <div class="otr-map-markers">${markers}</div>
    <aside aria-label="图例"><h3>图例</h3><ul>${legend}</ul></aside>
    <small class="otr-map-attribution">${escapeHtml(state.attribution)}</small>
  </section>`;
}

function escapeHtml(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
