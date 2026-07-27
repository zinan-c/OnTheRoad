export const FIXTURE_VERSION = "minimal-five-day@1";

export const LOCATIONS = Object.freeze([
  { id: "loc-bund", name: "上海地点标记", coordinates: [121.4906, 31.2413] },
  { id: "loc-zh-hotel", name: "舟山地点标记", coordinates: [122.1069, 30.0198] },
  { id: "loc-putuo", name: "普陀山地点标记", coordinates: [122.3867, 30.0097] },
]);

export const ROUTES = Object.freeze({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { mode: "flight", label: "飞机虚线弧线" },
      geometry: {
        type: "LineString",
        coordinates: [
          [121.4906, 31.2413],
          [121.75, 31.43],
          [122.1069, 30.0198],
        ],
      },
    },
    {
      type: "Feature",
      properties: { mode: "walk", label: "步行点线" },
      geometry: {
        type: "LineString",
        coordinates: [
          [122.1069, 30.0198],
          [122.135, 30.04],
        ],
      },
    },
    {
      type: "Feature",
      properties: { mode: "road", label: "道路交通实线" },
      geometry: {
        type: "LineString",
        coordinates: [
          [122.135, 30.04],
          [122.25, 30.08],
        ],
      },
    },
    {
      type: "Feature",
      properties: { mode: "ferry", label: "船运蓝色航线" },
      geometry: {
        type: "LineString",
        coordinates: [
          [122.25, 30.08],
          [122.3867, 30.0097],
        ],
      },
    },
  ],
});
