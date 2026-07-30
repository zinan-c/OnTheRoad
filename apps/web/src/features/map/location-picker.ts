import type {
  CoordinateInputMode,
  Wgs84Point,
} from "@on-the-road/application/location";

type LocationView = {
  readonly version: number;
  readonly point: Wgs84Point | null;
  readonly manuallyAdjusted: boolean;
};

export interface LocationPickerGateway {
  get(): Promise<{ location: LocationView }>;
  drag(
    point: Wgs84Point,
    ifMatch: string,
    inputMode: CoordinateInputMode,
  ): Promise<{ location: LocationView; etag: string }>;
  pick?(
    point: Wgs84Point,
    ifMatch: string,
  ): Promise<{ location: LocationView; etag: string }>;
  manual?(
    point: Wgs84Point,
    ifMatch: string,
  ): Promise<{ location: LocationView; etag: string }>;
}

export type LocationPickerState = Readonly<{
  status: "idle" | "loading" | "ready" | "saving" | "error";
  version: number | null;
  point: Wgs84Point | null;
  center: readonly [number, number] | null;
  manuallyAdjusted: boolean;
  error: string | null;
}>;

export class LocationPicker {
  state: LocationPickerState = {
    status: "idle",
    version: null,
    point: null,
    center: null,
    manuallyAdjusted: false,
    error: null,
  };

  constructor(readonly gateway: LocationPickerGateway) {}

  async load(): Promise<void> {
    this.state = { ...this.state, status: "loading", error: null };
    try {
      this.#apply((await this.gateway.get()).location);
    } catch {
      this.state = { ...this.state, status: "error", error: "坐标加载失败" };
    }
  }

  async dragMarker(point: Wgs84Point, inputMode: CoordinateInputMode): Promise<void> {
    if (this.state.version === null) throw new Error("Location must be loaded before dragging");
    const previous = this.state;
    this.state = {
      ...this.state,
      status: "saving",
      point,
      center: [point.longitude, point.latitude],
      error: null,
    };
    try {
      const result = await this.gateway.drag(
        point,
        `"${previous.version}"`,
        inputMode,
      );
      this.#apply(result.location);
    } catch (error) {
      this.state = {
        ...previous,
        status: "error",
        error: error instanceof Error ? error.message : "坐标保存失败",
      };
      throw error;
    }
  }

  async pickPoint(point: Wgs84Point, pointerTravelPixels = 0): Promise<boolean> {
    if (pointerTravelPixels > 5) return false;
    if (!this.gateway.pick || this.state.version === null) {
      throw new Error("Map picking is not available");
    }
    const result = await this.gateway.pick(point, `"${this.state.version}"`);
    this.#apply(result.location);
    return true;
  }

  async enterCoordinates(point: Wgs84Point): Promise<void> {
    if (!this.gateway.manual || this.state.version === null) {
      throw new Error("Manual coordinates are not available");
    }
    const result = await this.gateway.manual(point, `"${this.state.version}"`);
    this.#apply(result.location);
  }

  #apply(location: LocationView): void {
    this.state = {
      status: "ready",
      version: location.version,
      point: location.point,
      center: location.point
        ? [location.point.longitude, location.point.latitude]
        : null,
      manuallyAdjusted: location.manuallyAdjusted,
      error: null,
    };
  }
}
