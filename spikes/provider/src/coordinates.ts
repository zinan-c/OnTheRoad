export type Crs = "WGS84" | "GCJ-02" | "BD-09";

export interface Coordinate {
  longitude: number;
  latitude: number;
  crs?: Crs;
}

export interface Wgs84Coordinate extends Coordinate {
  crs: "WGS84";
}

const EARTH_RADIUS_METERS = 6_371_008.8;
const GCJ_A = 6_378_245;
const GCJ_EE = 0.006693421622965943;
const X_PI = Math.PI * 3_000 / 180;

function assertCoordinate(coordinate: Coordinate): void {
  if (
    !Number.isFinite(coordinate.longitude) ||
    !Number.isFinite(coordinate.latitude) ||
    coordinate.longitude < -180 ||
    coordinate.longitude > 180 ||
    coordinate.latitude < -90 ||
    coordinate.latitude > 90
  ) {
    throw new Error("COORDINATE_OUT_OF_RANGE");
  }
}

function outsideMainlandChina(longitude: number, latitude: number): boolean {
  return longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271;
}

function transformLatitude(longitude: number, latitude: number): number {
  let value = -100 + 2 * longitude + 3 * latitude + 0.2 * latitude ** 2
    + 0.1 * longitude * latitude + 0.2 * Math.sqrt(Math.abs(longitude));
  value += (20 * Math.sin(6 * longitude * Math.PI) + 20 * Math.sin(2 * longitude * Math.PI)) * 2 / 3;
  value += (20 * Math.sin(latitude * Math.PI) + 40 * Math.sin(latitude / 3 * Math.PI)) * 2 / 3;
  value += (160 * Math.sin(latitude / 12 * Math.PI) + 320 * Math.sin(latitude * Math.PI / 30)) * 2 / 3;
  return value;
}

function transformLongitude(longitude: number, latitude: number): number {
  let value = 300 + longitude + 2 * latitude + 0.1 * longitude ** 2
    + 0.1 * longitude * latitude + 0.1 * Math.sqrt(Math.abs(longitude));
  value += (20 * Math.sin(6 * longitude * Math.PI) + 20 * Math.sin(2 * longitude * Math.PI)) * 2 / 3;
  value += (20 * Math.sin(longitude * Math.PI) + 40 * Math.sin(longitude / 3 * Math.PI)) * 2 / 3;
  value += (150 * Math.sin(longitude / 12 * Math.PI) + 300 * Math.sin(longitude / 30 * Math.PI)) * 2 / 3;
  return value;
}

export function wgs84ToGcj02(coordinate: Coordinate): Coordinate {
  assertCoordinate(coordinate);
  const { longitude, latitude } = coordinate;
  if (outsideMainlandChina(longitude, latitude)) return { longitude, latitude, crs: "GCJ-02" };
  let deltaLatitude = transformLatitude(longitude - 105, latitude - 35);
  let deltaLongitude = transformLongitude(longitude - 105, latitude - 35);
  const radians = latitude / 180 * Math.PI;
  let magic = Math.sin(radians);
  magic = 1 - GCJ_EE * magic ** 2;
  const rootMagic = Math.sqrt(magic);
  deltaLatitude = deltaLatitude * 180 / ((GCJ_A * (1 - GCJ_EE) / (magic * rootMagic)) * Math.PI);
  deltaLongitude = deltaLongitude * 180 / (GCJ_A / rootMagic * Math.cos(radians) * Math.PI);
  return { longitude: longitude + deltaLongitude, latitude: latitude + deltaLatitude, crs: "GCJ-02" };
}

export function gcj02ToWgs84(coordinate: Coordinate): Wgs84Coordinate {
  assertCoordinate(coordinate);
  if (outsideMainlandChina(coordinate.longitude, coordinate.latitude)) {
    return { longitude: coordinate.longitude, latitude: coordinate.latitude, crs: "WGS84" };
  }
  let longitude = coordinate.longitude;
  let latitude = coordinate.latitude;
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const projected = wgs84ToGcj02({ longitude, latitude });
    const longitudeError = projected.longitude - coordinate.longitude;
    const latitudeError = projected.latitude - coordinate.latitude;
    longitude -= longitudeError;
    latitude -= latitudeError;
    if (Math.abs(longitudeError) < 1e-9 && Math.abs(latitudeError) < 1e-9) break;
  }
  return { longitude, latitude, crs: "WGS84" };
}

export function gcj02ToBd09(coordinate: Coordinate): Coordinate {
  assertCoordinate(coordinate);
  const radius = Math.sqrt(coordinate.longitude ** 2 + coordinate.latitude ** 2)
    + 0.00002 * Math.sin(coordinate.latitude * X_PI);
  const angle = Math.atan2(coordinate.latitude, coordinate.longitude)
    + 0.000003 * Math.cos(coordinate.longitude * X_PI);
  return {
    longitude: radius * Math.cos(angle) + 0.0065,
    latitude: radius * Math.sin(angle) + 0.006,
    crs: "BD-09"
  };
}

export function bd09ToGcj02(coordinate: Coordinate): Coordinate {
  assertCoordinate(coordinate);
  const longitude = coordinate.longitude - 0.0065;
  const latitude = coordinate.latitude - 0.006;
  const radius = Math.sqrt(longitude ** 2 + latitude ** 2) - 0.00002 * Math.sin(latitude * X_PI);
  const angle = Math.atan2(latitude, longitude) - 0.000003 * Math.cos(longitude * X_PI);
  return {
    longitude: radius * Math.cos(angle),
    latitude: radius * Math.sin(angle),
    crs: "GCJ-02"
  };
}

export function toWgs84(coordinate: Coordinate, sourceCrs?: Crs): Wgs84Coordinate {
  const crs = sourceCrs ?? coordinate.crs;
  if (!crs) throw new Error("COORDINATE_CRS_REQUIRED");
  assertCoordinate(coordinate);
  if (crs === "WGS84") return { longitude: coordinate.longitude, latitude: coordinate.latitude, crs: "WGS84" };
  if (crs === "GCJ-02") return gcj02ToWgs84(coordinate);
  if (crs === "BD-09") return gcj02ToWgs84(bd09ToGcj02(coordinate));
  throw new Error("COORDINATE_CRS_UNSUPPORTED");
}

export function coordinateErrorMeters(
  left: Pick<Coordinate, "longitude" | "latitude">,
  right: Pick<Coordinate, "longitude" | "latitude">,
): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(value));
}
