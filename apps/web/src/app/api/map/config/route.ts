import { loadProcessConfig } from "@on-the-road/config/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LAYERS = [
  { id: "amap-street", label: "标准地图", provider: "amap", engine: "amap-js", attribution: "© 高德地图", enabled: true },
  { id: "amap-satellite", label: "卫星影像", provider: "amap", engine: "amap-js", attribution: "© 高德地图", enabled: true },
  { id: "amap-satellite-labels", label: "卫星+路网", provider: "amap", engine: "amap-js", attribution: "© 高德地图", enabled: true },
] as const;

export async function GET(): Promise<Response> {
  try {
    const config = loadProcessConfig("web", process.env);
    return Response.json({
      provider: config.map.client.provider,
      engine: config.map.client.engine,
      ...(config.map.client.jsApiKey ? { jsApiKey: config.map.client.jsApiKey } : {}),
      ...(config.map.client.securityJsCode ? { securityJsCode: config.map.client.securityJsCode } : {}),
      defaultLayer: config.map.client.defaultLayer,
      attribution: config.map.client.attribution,
      layers: LAYERS,
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
