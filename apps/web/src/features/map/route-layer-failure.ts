import { routeStyle, type RouteQuality, type RouteStatus, type RouteStyle } from "./route-style.js";

export type RouteLayerModel = {
  readonly visible: boolean;
  readonly style: RouteStyle;
  readonly geometry: readonly [number, number][];
  readonly message: string;
};

function validPoint(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && value.length === 2
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
    && value[0] >= -180 && value[0] <= 180
    && value[1] >= -90 && value[1] <= 90;
}

export function routeLayerModel(input: {
  readonly modeCode?: string | null;
  readonly quality: RouteQuality;
  readonly status: RouteStatus;
  readonly geometry?: readonly (readonly [number, number])[] | null;
}): RouteLayerModel {
  const style = routeStyle(input);
  const geometry = (input.geometry ?? []).filter(validPoint);
  if (input.status === "obsolete") return { visible: false, style, geometry: [], message: "Route is obsolete" };
  if (input.status === "failed") return { visible: false, style, geometry: [], message: "Route calculation failed; endpoint details remain available" };
  if (geometry.length < 2) return { visible: false, style, geometry, message: "Route geometry unavailable; showing endpoint text" };
  return {
    visible: true,
    style,
    geometry,
    message: style.isApproximate ? `${style.qualityLabel}; not turn-by-turn navigation` : style.qualityLabel,
  };
}
