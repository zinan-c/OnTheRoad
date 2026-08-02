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
  if (input.status === "obsolete") return { visible: false, style, geometry: [], message: "路线已过期" };
  if (input.status === "failed") return { visible: false, style, geometry: [], message: "路线计算失败，可查看起终点信息" };
  if (geometry.length < 2) return { visible: false, style, geometry, message: "路线几何不可用，显示文字起终点" };
  return {
    visible: true,
    style,
    geometry,
    message: style.isApproximate ? `${style.qualityLabel}，不代表真实导航` : style.qualityLabel,
  };
}
