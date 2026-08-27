import { loadProcessConfig } from "@on-the-road/config/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LAYERS = [
  { id: "amap-street", label: "标准地图", provider: "amap", engine: "amap-js", attribution: "© 高德地图", enabled: true },
  { id: "amap-satellite", label: "卫星影像", provider: "amap", engine: "amap-js", attribution: "© 高德地图", enabled: true },
  { id: "amap-satellite-labels", label: "卫星+路网", provider: "amap", engine: "amap-js", attribution: "© 高德地图", enabled: true },
] as const;

const MAPBOX_LAYERS = [
  {
    id: "mapbox-streets",
    label: "Mapbox 街道",
    provider: "mapbox",
    engine: "maplibre",
    attribution: "© Mapbox © OpenStreetMap contributors",
    enabled: true,
  },
] as const;

export async function GET(): Promise<Response> {
  // MAP_PROFILE is deployment-scoped. A hybrid deployment cannot safely
  // expose one browser map provider because the selected Trip is not part of
  // this request; fail closed before loading the broader process config.
  if (process.env.MAP_PROFILE?.trim() === "hybrid") {
    return Response.json({
      code: "MAP_PROFILE_REQUIRES_TRIP_SCOPE",
      title: "Hybrid map runtime requires an explicit Trip map profile",
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  try {
    const config = loadProcessConfig("web", process.env);
    const mapbox = config.map.client.provider === "mapbox";
    return Response.json({
      provider: config.map.client.provider,
      engine: config.map.client.engine,
      ...(config.map.client.jsApiKey ? { jsApiKey: config.map.client.jsApiKey } : {}),
      ...(config.map.client.securityJsCode ? { securityJsCode: config.map.client.securityJsCode } : {}),
      ...(mapbox ? {
        mapboxPublicToken: config.map.client.mapboxPublicToken,
        tileTemplate: config.map.client.tileTemplate,
        tileSize: config.map.client.tileSize,
        maxZoom: config.map.client.maxZoom,
        showMapboxLogo: config.map.client.showMapboxLogo,
      } : {}),
      defaultLayer: config.map.client.defaultLayer,
      attribution: config.map.client.attribution,
      layers: mapbox ? MAPBOX_LAYERS : LAYERS,
    }, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    // Never serialize ConfigValidationError: it may contain field names that
    // are useful to operators but this endpoint is intentionally public.
    return Response.json({
      code: "MAP_CONFIG_UNAVAILABLE",
      title: "Map configuration is unavailable",
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
