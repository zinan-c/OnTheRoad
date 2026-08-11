export const TRIP_MAP_RUNTIME_OPTIONS = {
  // Keep a small asset version in the URL so browsers do not retain the old
  // repeated placeholder tile after the fixture basemap changes.
  tileTemplate: "/api/map/tiles/{z}/{x}/{y}?v=2",
  attribution: "Map data © On The Road fixture",
} as const;
