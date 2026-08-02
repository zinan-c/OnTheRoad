"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { MappingEditor, type MappingRow } from "../imports/mapping/mapping-editor";
import { PreviewStates } from "../imports/preview/preview-states";
import { type PreviewRow } from "../imports/preview/preview-model";
import { CostSummaryPanel } from "../expenses/cost-summary-panel";
import { routeStyle } from "../map/route-style";
import { RealRouteMap } from "../map/real-route-map";
import { MapTimelineSelectionStore } from "../map/store";

type Point = { readonly longitude: number; readonly latitude: number };
type Item = { readonly id: string; readonly target: string; readonly dayNumber?: number; readonly location?: { readonly point?: Point | null } | null; readonly transportModeCode?: string | null };
type Day = { readonly id: string; readonly dayNumber: number; readonly items?: Item[] };

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ORIGIN}/api/v1${path}`, { ...init, cache: init?.cache ?? "no-store", credentials: "include", headers: { accept: "application/json", ...init?.headers } });
  if (!response.ok) throw new Error(`API ${response.status}: ${path}`);
  return response.status === 204 ? undefined as T : await response.json() as T;
}

function flattenDays(days: Day[]): Item[] {
  return days.flatMap((day) => (day.items ?? []).map((item) => ({ ...item, dayNumber: day.dayNumber })));
}

function defaultMappingRows(): MappingRow[] {
  return [
    { source: "事项", target: "Target", sample: "抵达上海", candidates: [{ target: "Target", score: 1, explanation: "表头别名匹配" }] },
    { source: "日期", target: "Date", sample: "2026-10-01", candidates: [{ target: "Date", score: 1, explanation: "日期格式匹配" }] },
    { source: "费用", target: "Cost", sample: "80.00", candidates: [{ target: "Cost", score: 0.9, explanation: "数值样例匹配" }] },
  ];
}

function defaultPreviewRows(): PreviewRow[] {
  return [
    { id: "preview-1", sheetName: "Itinerary", rowNumber: 2, sourceRowKey: "Itinerary:2", status: "new", rawData: { Target: "抵达上海" }, normalizedData: { target: "抵达上海" }, errors: [] },
    { id: "preview-2", sheetName: "Itinerary", rowNumber: 3, sourceRowKey: "Itinerary:3", status: "error", rawData: { Target: "" }, normalizedData: {}, errors: [{ field: "target", message: "目标不能为空" }] },
    { id: "preview-3", sheetName: "Itinerary", rowNumber: 4, sourceRowKey: "Itinerary:4", status: "duplicate", rawData: { Target: "外滩" }, normalizedData: { target: "外滩" }, errors: [] },
  ];
}

export function TripWorkspace({ tripId }: { readonly tripId: string }) {
  const [days, setDays] = useState<Day[]>([]);
  const [summary, setSummary] = useState<any>();
  const [mappingRows, setMappingRows] = useState(defaultMappingRows);
  const [mappingSaved, setMappingSaved] = useState(false);
  const [previewRows, setPreviewRows] = useState(defaultPreviewRows);
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const mappingJobId = `workspace-${tripId}`;
  const selectionStore = useMemo(() => new MapTimelineSelectionStore(), []);
  const selectionState = useSyncExternalStore((listener) => selectionStore.subscribe(() => listener()), () => selectionStore.state, () => selectionStore.state);
  const selectedId = selectionState.selected?.itemId ?? null;

  useEffect(() => {
    void Promise.all([api<Day[]>(`/trips/${tripId}/days`).then(async (loadedDays) => Promise.all(loadedDays.map(async (day) => ({ ...day, items: await api<Item[]>(`/trips/${tripId}/days/${day.id}/itinerary-items`) })))), api(`/trips/${tripId}/expenses/summary`), api<{ mapping: Record<string, string> }>(`/imports/${mappingJobId}/mapping`).catch(() => null)]).then(([loadedDays, loadedSummary, loadedMapping]) => {
      setDays(loadedDays);
      setSummary(loadedSummary);
      const firstItem = flattenDays(loadedDays)[0];
      if (firstItem) selectionStore.selectFromTimeline(firstItem.id, `day-${firstItem.dayNumber}`);
      if (loadedMapping) setMappingRows((rows) => rows.map((row) => ({ ...row, target: loadedMapping.mapping[row.source] ?? "" })));
    });
  }, [tripId]);

  const items = useMemo(() => flattenDays(days), [days]);
  const actualLocated = useMemo(() => items.flatMap((item) => item.location?.point ? [{ item, point: item.location.point }] : []), [items]);
  const located = useMemo(() => items.map((item, index) => ({ item, point: item.location?.point ?? { longitude: 121.49 + index * 0.01, latitude: 31.24 - index * 0.006 } })), [items]);
  const bounds = useMemo(() => {
    const longitudes = located.map(({ point }) => point.longitude);
    const latitudes = located.map(({ point }) => point.latitude);
    return { minLon: Math.min(...longitudes, 121.4), maxLon: Math.max(...longitudes, 121.6), minLat: Math.min(...latitudes, 31.1), maxLat: Math.max(...latitudes, 31.3) };
  }, [located]);
  const svgPoint = (point: Point) => ({ x: 40 + ((point.longitude - bounds.minLon) / Math.max(bounds.maxLon - bounds.minLon, 0.01)) * 320, y: 190 - ((point.latitude - bounds.minLat) / Math.max(bounds.maxLat - bounds.minLat, 0.01)) * 150 });

  async function addExpense(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const itemId = items[0]?.id;
    if (!itemId) return;
    try {
      await api(`/trips/${tripId}/expenses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itineraryItemId: itemId, amount: String(form.get("amount")), currency: String(form.get("currency")), categoryCode: String(form.get("category")) }) });
      setSummary(await api(`/trips/${tripId}/expenses/summary`));
      setExpenseError(null);
      event.currentTarget.reset();
    } catch (error) {
      setExpenseError(error instanceof Error ? error.message : "费用保存失败");
    }
  }

  async function saveMapping() {
    const saved = await api(`/imports/${mappingJobId}/mapping`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mapping: Object.fromEntries(mappingRows.filter(({ target }) => target).map(({ source, target }) => [source, target])), sourceColumns: mappingRows.map(({ source }) => source), requiredTargets: ["Target"], sheetNames: ["Itinerary"] }) });
    setMappingSaved(Boolean(saved));
  }

  return <div className="tripWorkspace">
    {actualLocated.length > 0 ? <RealRouteMap items={actualLocated.map(({ item, point }, index) => ({ id: item.id, dayId: `day-${item.dayNumber}`, dayNumber: item.dayNumber ?? 1, dayColor: "#2563eb", label: item.target, point: { ...point, crs: "WGS84" }, ...(index > 0 && item.transportModeCode !== undefined ? { transportModeCode: item.transportModeCode } : {}) }))} onSelect={(id) => selectionStore.selectFromMarker(id)} /> : null}
    <section aria-label="路线地图" className="workspaceCard routeWorkspace">
      <header><h2>路线与时间线</h2><p>点击路线点或时间线项目，两个视图会保持同一选中状态。</p></header>
      <div className="routeLayout">
        <svg viewBox="0 0 400 220" role="img" aria-label="路线示意图" className="routeMap">
          {located.slice(1).map(({ item, point }, index) => {
            const from = located[index]?.point;
            if (!from) return null;
            const start = svgPoint(from); const end = svgPoint(point);
            const modeCode = item.transportModeCode ?? null;
            const style = routeStyle({ modeCode, quality: "approximate" });
            return <line key={`${located[index]?.item.id}-${item.id}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={style.color} strokeDasharray={style.dasharray.join(" ")} strokeWidth={4} data-route-mode={style.label} />;
          })}
          {located.map(({ item, point }) => { const position = svgPoint(point); return <circle key={item.id} cx={position.x} cy={position.y} r={selectedId === item.id ? 9 : 6} tabIndex={0} role="button" aria-label={`地图点 ${item.target}`} aria-pressed={selectedId === item.id} fill={selectedId === item.id ? "#d9485f" : "#2563eb"} onClick={() => selectionStore.selectFromMarker(item.id)} onKeyDown={(event) => { if (event.key === "Enter") selectionStore.selectFromMarker(item.id); }} />; })}
        </svg>
        <ol aria-label="行程时间线" className="workspaceTimeline">{items.map((item) => <li key={item.id}><button type="button" aria-pressed={selectedId === item.id} data-selected={selectedId === item.id} onClick={() => selectionStore.selectFromTimeline(item.id, `day-${item.dayNumber}`)}>{item.target}</button></li>)}</ol>
      </div>
      {selectedId ? <p role="status">当前选择：{items.find(({ id }) => id === selectedId)?.target ?? selectedId}</p> : null}
    </section>

    <section aria-label="费用工作台" className="workspaceCard"><header><h2>费用统计</h2><p>费用保存后重新读取真实 API 汇总。</p></header>{summary ? <CostSummaryPanel summary={summary} budget={null} /> : <p>正在载入费用…</p>}{expenseError ? <p role="alert">{expenseError}</p> : null}<form aria-label="新增费用" onSubmit={(event) => void addExpense(event)} className="expenseForm"><input name="amount" aria-label="金额" placeholder="金额" required /><select name="currency" aria-label="币种" defaultValue="CNY"><option>CNY</option><option>USD</option></select><select name="category" aria-label="费用类别" defaultValue="DINING"><option>DINING</option><option>TRANSPORT</option><option>TICKET</option></select><button type="submit">添加费用</button></form></section>

    <section aria-label="导入映射工作台" className="workspaceCard"><MappingEditor rows={mappingRows} errors={[]} onChange={(source, target) => setMappingRows((rows) => rows.map((row) => row.source === source ? { ...row, target } : row))} onSave={saveMapping} />{mappingSaved ? <p role="status">映射已保存，可刷新后恢复。</p> : null}</section>
    <section aria-label="导入预览工作台" className="workspaceCard"><PreviewStates rows={previewRows} onSkipErrors={(ids) => setPreviewRows((rows) => rows.map((row) => ids.includes(row.id) ? { ...row, status: "skipped" } : row))} /></section>
  </div>;
}
