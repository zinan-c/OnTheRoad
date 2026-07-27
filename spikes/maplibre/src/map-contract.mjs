export const ROUTE_STYLES = Object.freeze({
  flight: {
    label: "飞机",
    color: "#7c3aed",
    width: 4,
    dasharray: [3, 2],
  },
  walk: {
    label: "步行",
    color: "#334155",
    width: 4,
    dasharray: [0.5, 1.5],
  },
  road: {
    label: "道路交通",
    color: "#dc5a3a",
    width: 5,
    dasharray: [1, 0],
  },
  ferry: {
    label: "船运",
    color: "#087ea4",
    width: 5,
    dasharray: [4, 2],
  },
});

/** @param {unknown} coordinates */
export function normalizeWgs84(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length !== 2) {
    throw new Error("WGS84_INVALID_COORDINATE");
  }
  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw new Error("WGS84_OUT_OF_RANGE");
  }
  return { longitude, latitude };
}

/** @param {"map-click" | "marker-drag"} source @param {unknown} coordinates */
export function selectionEvent(source, coordinates) {
  return {
    type: "location-selected",
    source,
    point: normalizeWgs84(coordinates),
  };
}

/**
 * @param {readonly (readonly [number, number])[]} points
 * @param {number} [singlePointPadding]
 */
export function boundsForPoints(points, singlePointPadding = 0.05) {
  if (points.length === 0) return null;
  const normalized = points.map(normalizeWgs84);
  const west = Math.min(...normalized.map((point) => point.longitude));
  const east = Math.max(...normalized.map((point) => point.longitude));
  const south = Math.min(...normalized.map((point) => point.latitude));
  const north = Math.max(...normalized.map((point) => point.latitude));
  if (west === east && south === north) {
    return [
      [west - singlePointPadding, south - singlePointPadding],
      [east + singlePointPadding, north + singlePointPadding],
    ];
  }
  return [
    [west, south],
    [east, north],
  ];
}

/** @param {readonly (readonly [number, number])[]} points */
export function fitPlan(points) {
  const bounds = boundsForPoints(points);
  if (!bounds) {
    return { kind: "empty", message: "无坐标：请先确认地点" };
  }
  const first = points[0];
  const allSame = points.every(
    ([longitude, latitude]) =>
      longitude === first?.[0] && latitude === first?.[1],
  );
  if (points.length === 1) {
    return { kind: "single", message: "单点范围：已使用安全缩放", bounds };
  }
  if (allSame) {
    return { kind: "same", message: "同点范围：已使用安全缩放", bounds };
  }
  return { kind: "bounds", message: "已适配全部有效坐标", bounds };
}
