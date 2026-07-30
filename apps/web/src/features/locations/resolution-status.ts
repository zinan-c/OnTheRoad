import type { LocationInputStatus } from "./location-input.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderResolutionStatus(
  status: LocationInputStatus,
  error: string | null,
): string {
  const message = status === "searching"
    ? '<div role="status" aria-live="polite">正在搜索地点…</div>'
    : error
      ? `<div role="alert">${escapeHtml(error)}</div>`
      : "";
  const recovery = ["empty", "failed"].includes(status)
    ? '<div aria-label="地点恢复操作"><button data-action="retry-search">重新搜索</button><button data-action="relocate">重新定位</button><button data-action="pick-on-map">地图选点</button><button data-action="manual-coordinates">手工坐标</button><button data-action="save-text">暂存文字</button></div>'
    : "";
  return `${message}${recovery}`;
}
