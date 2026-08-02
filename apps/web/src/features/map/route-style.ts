import { transportModes } from "@on-the-road/config/reference-data";

export type RouteQuality = "actual" | "approximate" | "manual" | "unknown";
export type RouteStatus = "pending" | "resolving" | "resolved" | "failed" | "manual" | "obsolete";

export type RouteStyle = {
  readonly color: string;
  readonly dasharray: readonly number[];
  readonly icon: string;
  readonly label: string;
  readonly qualityLabel: string;
  readonly isApproximate: boolean;
};

const FALLBACK = { code: "OTHER", label: "其他", color: "#667085", lineStyle: "dashed", icon: "route-off" } as const;
const QUALITY_LABELS: Record<RouteQuality, string> = {
  actual: "真实路线",
  approximate: "示意路线",
  manual: "手工路线",
  unknown: "路线质量未知",
};

function dasharray(lineStyle: string): readonly number[] {
  if (lineStyle === "dotted") return [1, 2];
  if (lineStyle === "dashed") return [6, 4];
  return [1, 0];
}

export function routeStyle({ modeCode, quality, customMode }: { readonly modeCode?: string | null; readonly quality: RouteQuality; readonly customMode?: { readonly code: string; readonly label: string; readonly color: string; readonly lineStyle: string; readonly icon: string } }): RouteStyle {
  const mode = customMode ?? transportModes.find(({ code }) => code === modeCode) ?? FALLBACK;
  return {
    color: mode.color,
    dasharray: dasharray(mode.lineStyle),
    icon: mode.icon,
    label: mode.label,
    qualityLabel: QUALITY_LABELS[quality],
    isApproximate: quality !== "actual",
  };
}
