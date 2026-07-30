export type Wgs84Point = {
  longitude: number;
  latitude: number;
  crs: "WGS84";
};

export type MapItem = {
  id: string;
  dayNumber: number;
  dayId: string;
  dayColor: string;
  label: string;
  destinationId?: string;
  destinationLabel?: string;
  point?: Wgs84Point;
};

export type MapFilter =
  | { kind: "all" }
  | { kind: "day"; dayId: string }
  | { kind: "destination"; destinationId: string };

export type Coordinate = [number, number];
export type Bounds = [Coordinate, Coordinate];

export type MarkerProperties = {
  itemId: string;
  dayId: string;
  dayNumber: number;
  daySequence: number;
  dayColor: string;
  markerLabel: string;
  label: string;
  destinationId?: string;
  destinationLabel?: string;
};

export type MarkerFeature = {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: Coordinate };
  properties: MarkerProperties;
};

export type MapMarker = MarkerProperties & {
  id: string;
  coordinate: Coordinate;
  tooltip: string;
};

export type FitPlan =
  | { kind: "empty"; bounds: null; message: string }
  | { kind: "single" | "same" | "bounds"; bounds: Bounds; message: string };

export type MapModel = {
  geojson: { type: "FeatureCollection"; features: MarkerFeature[] };
  markers: MapMarker[];
  invalidItemIds: string[];
  unresolvedItemIds: string[];
  legend: Array<{ dayNumber: number; color: string; label: string }>;
  fit: FitPlan;
  filter: MapFilter;
};

const SINGLE_POINT_PADDING = 0.05;

export function filterMapItems(
  items: readonly MapItem[],
  filter: MapFilter = { kind: "all" },
): MapItem[] {
  if (filter.kind === "all") return [...items];
  if (filter.kind === "day") {
    return items.filter((item) => item.dayId === filter.dayId);
  }
  return items.filter((item) => item.destinationId === filter.destinationId);
}

export function buildMapModel(
  items: readonly MapItem[],
  filter: MapFilter = { kind: "all" },
): MapModel {
  const selected = filterMapItems(items, filter);
  const invalidItemIds: string[] = [];
  const unresolvedItemIds: string[] = [];
  const features: MarkerFeature[] = [];
  const markers: MapMarker[] = [];
  const sequenceByDay = new Map<string, number>();

  for (const item of selected) {
    if (!item.point) {
      unresolvedItemIds.push(item.id);
      continue;
    }
    if (!isValidPoint(item.point)) {
      invalidItemIds.push(item.id);
      continue;
    }

    const daySequence = (sequenceByDay.get(item.dayId) ?? 0) + 1;
    sequenceByDay.set(item.dayId, daySequence);
    const markerLabel = `Day ${item.dayNumber} · ${daySequence}`;
    const properties: MarkerProperties = {
      itemId: item.id,
      dayId: item.dayId,
      dayNumber: item.dayNumber,
      daySequence,
      dayColor: item.dayColor,
      markerLabel,
      label: item.label,
      ...(item.destinationId ? { destinationId: item.destinationId } : {}),
      ...(item.destinationLabel ? { destinationLabel: item.destinationLabel } : {}),
    };
    const coordinate: Coordinate = [item.point.longitude, item.point.latitude];
    features.push({
      type: "Feature",
      id: item.id,
      geometry: { type: "Point", coordinates: coordinate },
      properties,
    });
    markers.push({
      ...properties,
      id: item.id,
      coordinate,
      tooltip: `${markerLabel} · ${item.label}`,
    });
  }

  const legendByDay = new Map<number, { dayNumber: number; color: string; label: string }>();
  for (const item of selected) {
    if (!legendByDay.has(item.dayNumber)) {
      legendByDay.set(item.dayNumber, {
        dayNumber: item.dayNumber,
        color: item.dayColor,
        label: `Day ${item.dayNumber}`,
      });
    }
  }

  return {
    geojson: { type: "FeatureCollection", features },
    markers,
    invalidItemIds,
    unresolvedItemIds,
    legend: [...legendByDay.values()].sort((a, b) => a.dayNumber - b.dayNumber),
    fit: fitPlan(markers.map(({ coordinate }) => coordinate)),
    filter,
  };
}

export function fitPlan(points: readonly Coordinate[]): FitPlan {
  if (points.length === 0) {
    return {
      kind: "empty",
      bounds: null,
      message: "无有效坐标：请先确认地点",
    };
  }

  let west = points[0]![0];
  let east = west;
  let south = points[0]![1];
  let north = south;
  for (const [longitude, latitude] of points.slice(1)) {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }

  if (west === east && south === north) {
    const kind = points.length === 1 ? "single" : "same";
    return {
      kind,
      bounds: [
        [west - SINGLE_POINT_PADDING, south - SINGLE_POINT_PADDING],
        [east + SINGLE_POINT_PADDING, north + SINGLE_POINT_PADDING],
      ],
      message: kind === "single" ? "已适配单个有效坐标" : "有效坐标重合，已扩展视野",
    };
  }

  return {
    kind: "bounds",
    bounds: [[west, south], [east, north]],
    message: "已适配全部有效坐标",
  };
}

function isValidPoint(point: Wgs84Point): boolean {
  return point.crs === "WGS84"
    && Number.isFinite(point.longitude)
    && Number.isFinite(point.latitude)
    && point.longitude >= -180
    && point.longitude <= 180
    && point.latitude >= -90
    && point.latitude <= 90;
}
