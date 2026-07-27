export type Crs = "WGS84" | "GCJ-02" | "BD-09";

export interface GoldenPoint {
  id: string;
  country: string;
  sourceCrs: Crs;
  source: { longitude: number; latitude: number };
  expectedWgs84: { longitude: number; latitude: number };
}

export const geoGolden: readonly GoldenPoint[] = [
  { id: "shanghai-pvg", country: "CN", sourceCrs: "WGS84", source: { longitude: 121.8052, latitude: 31.1434 }, expectedWgs84: { longitude: 121.8052, latitude: 31.1434 } },
  { id: "shanghai-bund", country: "CN", sourceCrs: "GCJ-02", source: { longitude: 121.49506598, latitude: 31.23931428 }, expectedWgs84: { longitude: 121.4906, latitude: 31.2413 } },
  { id: "shanghai-yuyuan", country: "CN", sourceCrs: "BD-09", source: { longitude: 121.50317031, latitude: 31.23074953 }, expectedWgs84: { longitude: 121.4921, latitude: 31.2271 } },
  { id: "beijing-tiananmen", country: "CN", sourceCrs: "GCJ-02", source: { longitude: 116.40363255, latitude: 39.91012548 }, expectedWgs84: { longitude: 116.397389, latitude: 39.908722 } },
  { id: "guangzhou-center", country: "CN", sourceCrs: "BD-09", source: { longitude: 113.27613577, latitude: 23.13272312 }, expectedWgs84: { longitude: 113.264385, latitude: 23.129112 } },
  { id: "chengdu-center", country: "CN", sourceCrs: "GCJ-02", source: { longitude: 104.06904598, latitude: 30.56981459 }, expectedWgs84: { longitude: 104.066541, latitude: 30.572269 } },
  { id: "zhoushan", country: "CN", sourceCrs: "BD-09", source: { longitude: 122.21792387, latitude: 29.98856377 }, expectedWgs84: { longitude: 122.2072, latitude: 29.9853 } },
  { id: "putuoshan", country: "CN", sourceCrs: "GCJ-02", source: { longitude: 122.39101132, latitude: 30.00744745 }, expectedWgs84: { longitude: 122.3867, latitude: 30.0097 } },
  { id: "new-york", country: "US", sourceCrs: "WGS84", source: { longitude: -74.006, latitude: 40.7128 }, expectedWgs84: { longitude: -74.006, latitude: 40.7128 } },
  { id: "london", country: "GB", sourceCrs: "WGS84", source: { longitude: -0.1276, latitude: 51.5072 }, expectedWgs84: { longitude: -0.1276, latitude: 51.5072 } },
  { id: "tokyo", country: "JP", sourceCrs: "WGS84", source: { longitude: 139.6917, latitude: 35.6895 }, expectedWgs84: { longitude: 139.6917, latitude: 35.6895 } },
  { id: "sydney", country: "AU", sourceCrs: "WGS84", source: { longitude: 151.2093, latitude: -33.8688 }, expectedWgs84: { longitude: 151.2093, latitude: -33.8688 } }
] as const;
