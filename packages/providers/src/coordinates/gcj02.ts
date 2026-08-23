import type { Wgs84Point } from "../contracts/dto.js";

/** Coordinates accepted by the AMap Web Service and JS APIs. */
export interface Gcj02Point {
  readonly longitude: number;
  readonly latitude: number;
  readonly crs: "GCJ02";
}

const PI = Math.PI;
const EARTH_SEMIMAJOR_AXIS = 6_378_245;
const ECCENTRICITY_SQUARED = 0.006693421622965943;

function assertFinitePoint(
  point: { readonly longitude: number; readonly latitude: number },
  crs: "WGS84" | "GCJ02",
): void {
  if (
    !Number.isFinite(point.longitude)
    || !Number.isFinite(point.latitude)
    || point.longitude < -180
    || point.longitude > 180
    || point.latitude < -90
    || point.latitude > 90
  ) {
    throw new TypeError(`A valid ${crs} point is required`);
  }
}

export function assertGcj02Point(point: Gcj02Point): void {
  if (point.crs !== "GCJ02") throw new TypeError("A GCJ02 point is required");
  assertFinitePoint(point, "GCJ02");
}

function outsideChina(longitude: number, latitude: number): boolean {
  return longitude < 72.004
    || longitude > 137.8347
    || latitude < 0.8293
    || latitude > 55.8271;
}

function transformLatitude(longitude: number, latitude: number): number {
  let result = -100 + (2 * longitude) + (3 * latitude)
    + (0.2 * latitude * latitude)
    + (0.1 * longitude * latitude)
    + (0.2 * Math.sqrt(Math.abs(longitude)));
  result += ((20 * Math.sin(6 * longitude * PI)) + (20 * Math.sin(2 * longitude * PI))) * 2 / 3;
  result += ((20 * Math.sin(latitude * PI)) + (40 * Math.sin(latitude / 3 * PI))) * 2 / 3;
  result += ((160 * Math.sin(latitude / 12 * PI)) + (320 * Math.sin(latitude * PI / 30))) * 2 / 3;
  return result;
}

function transformLongitude(longitude: number, latitude: number): number {
  let result = 300 + longitude + (2 * latitude)
    + (0.1 * longitude * longitude)
    + (0.1 * longitude * latitude)
    + (0.1 * Math.sqrt(Math.abs(longitude)));
  result += ((20 * Math.sin(6 * longitude * PI)) + (20 * Math.sin(2 * longitude * PI))) * 2 / 3;
  result += ((20 * Math.sin(longitude * PI)) + (40 * Math.sin(longitude / 3 * PI))) * 2 / 3;
  result += ((150 * Math.sin(longitude / 12 * PI)) + (300 * Math.sin(longitude / 30 * PI))) * 2 / 3;
  return result;
}

function offset(point: Wgs84Point): { readonly longitude: number; readonly latitude: number } {
  let latitudeDelta = transformLatitude(point.longitude - 105, point.latitude - 35);
  let longitudeDelta = transformLongitude(point.longitude - 105, point.latitude - 35);
  const radianLatitude = point.latitude / 180 * PI;
  let magic = Math.sin(radianLatitude);
  magic = 1 - (ECCENTRICITY_SQUARED * magic * magic);
  const rootMagic = Math.sqrt(magic);
  latitudeDelta = latitudeDelta * 180
    / ((EARTH_SEMIMAJOR_AXIS * (1 - ECCENTRICITY_SQUARED)) / (magic * rootMagic) * PI);
  longitudeDelta = longitudeDelta * 180
    / (EARTH_SEMIMAJOR_AXIS / rootMagic * Math.cos(radianLatitude) * PI);
  return { longitude: longitudeDelta, latitude: latitudeDelta };
}

/** Converts the domain's WGS84 point into the CRS required by AMap. */
export function wgs84ToGcj02(point: Wgs84Point): Gcj02Point {
  if (point.crs !== "WGS84") throw new TypeError("A WGS84 point is required");
  assertFinitePoint(point, "WGS84");
  if (outsideChina(point.longitude, point.latitude)) {
    return { longitude: point.longitude, latitude: point.latitude, crs: "GCJ02" };
  }
  const delta = offset(point);
  return {
    longitude: point.longitude + delta.longitude,
    latitude: point.latitude + delta.latitude,
    crs: "GCJ02",
  };
}

/**
 * Converts a point returned by AMap back to the WGS84 domain CRS.
 *
 * The iterative inverse converges to sub-metre error for the mainland China
 * extent used by the application while remaining a pure, dependency-free
 * function that can be shared by Node and the browser bundle.
 */
export function gcj02ToWgs84(point: Gcj02Point): Wgs84Point {
  assertGcj02Point(point);
  if (outsideChina(point.longitude, point.latitude)) {
    return { longitude: point.longitude, latitude: point.latitude, crs: "WGS84" };
  }

  let candidate: Wgs84Point = {
    longitude: point.longitude,
    latitude: point.latitude,
    crs: "WGS84",
  };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const delta = offset(candidate);
    const next: Wgs84Point = {
      longitude: point.longitude - delta.longitude,
      latitude: point.latitude - delta.latitude,
      crs: "WGS84",
    };
    if (
      Math.abs(next.longitude - candidate.longitude) < 1e-10
      && Math.abs(next.latitude - candidate.latitude) < 1e-10
    ) {
      return next;
    }
    candidate = next;
  }
  return candidate;
}
