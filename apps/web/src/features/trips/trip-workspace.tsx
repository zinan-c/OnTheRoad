"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { MappingEditor, type MappingRow } from "../imports/mapping/mapping-editor";
import { PreviewStates } from "../imports/preview/preview-states";
import { type PreviewRow } from "../imports/preview/preview-model";
import { CostSummaryPanel } from "../expenses/cost-summary-panel";
import { routeStyle } from "../map/route-style";
import { RealRouteMap } from "../map/real-route-map";
import { MapTimelineSelectionStore } from "../map/store";
import { TripGallery } from "../attachments/trip-gallery";
import { ItineraryPanel } from "../itinerary/itinerary-panel";
import type { TransportModeView } from "./settings/transport-modes";

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

function digestBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function TripWorkspace({ tripId }: { readonly tripId: string }) {
  const [days, setDays] = useState<Day[]>([]);
  const [summary, setSummary] = useState<any>();
  const [mappingRows, setMappingRows] = useState(defaultMappingRows);
  const [mappingSaved, setMappingSaved] = useState(false);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewJobMissing, setPreviewJobMissing] = useState(false);
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [tripTransportModes, setTripTransportModes] = useState<TransportModeView[]>([]);
  const selectionStore = useMemo(() => new MapTimelineSelectionStore(), []);
  const selectionState = useSyncExternalStore((listener) => selectionStore.subscribe(() => listener()), () => selectionStore.state, () => selectionStore.state);
  const selectedId = selectionState.selected?.itemId ?? null;

  useEffect(() => {
    void (async () => {
      const [loadedDays, loadedSummary, latest, loadedTransportModes] = await Promise.all([api<Day[]>(`/trips/${tripId}/days`).then(async (loaded) => Promise.all(loaded.map(async (day) => ({ ...day, items: await api<Item[]>(`/trips/${tripId}/days/${day.id}/itinerary-items`) })))), api(`/trips/${tripId}/expenses/summary`), api<{ id: string } | null>(`/trips/${tripId}/imports/latest`).catch(() => null), api<TransportModeView[]>(`/trips/${tripId}/transport-modes`).catch(() => [])]);
      const jobId = latest?.id ?? null;
      const [loadedMapping, loadedPreview] = jobId ? await Promise.all([api<{ mapping: Record<string, string> }>(`/imports/${jobId}/mapping`).catch(() => null), api<{ rows: PreviewRow[] }>(`/imports/${jobId}/preview`).catch(() => null)]) : [null, null];
      setImportJobId(jobId);
      setDays(loadedDays);
      setSummary(loadedSummary);
      setTripTransportModes(loadedTransportModes);
      const firstItem = flattenDays(loadedDays)[0];
      if (firstItem) selectionStore.selectFromTimeline(firstItem.id, `day-${firstItem.dayNumber}`);
      if (loadedMapping && Object.keys(loadedMapping.mapping).length > 0) {
        setMappingRows((rows) => rows.map((row) => ({ ...row, target: loadedMapping.mapping[row.source] ?? "" })));
      }
      if (loadedPreview) setPreviewRows(loadedPreview.rows); else setPreviewJobMissing(true);
    })();
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
    if (!importJobId) return;
    const saved = await api(`/imports/${importJobId}/mapping`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mapping: Object.fromEntries(mappingRows.filter(({ target }) => target).map(({ source, target }) => [source, target])), sourceColumns: mappingRows.map(({ source }) => source), requiredTargets: ["Target"], sheetNames: ["Itinerary"] }) });
    setMappingSaved(Boolean(saved));
  }

  async function skipPreview(ids: readonly string[]) {
    if (!importJobId) return;
    await api(`/imports/${importJobId}/preview/skip`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) });
    const preview = await api<{ rows: PreviewRow[] }>(`/imports/${importJobId}/preview`);
    setPreviewRows(preview.rows);
  }

  async function uploadImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportStatus("正在创建上传会话…");
    try {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const checksumSha256 = digestBase64(digest);
      const session = await api<{ attachmentId: string; uploadUrl: string; headers?: Record<string, string> }>(`/trips/${tripId}/imports/uploads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: file.name, contentType: file.type, contentLength: file.size, checksumSha256 }) });
      setImportStatus("正在上传文件…");
      const uploaded = await fetch(session.uploadUrl, { method: "PUT", ...(session.headers ? { headers: session.headers } : {}), body: file });
      if (!uploaded.ok) throw new Error(`上传失败：${uploaded.status}`);
      await api(`/trips/${tripId}/imports/${session.attachmentId}/complete`, { method: "POST" });
      setImportStatus("正在扫描并检查文件…");
      const inspection = await api<{ id: string }>(`/trips/${tripId}/imports/${session.attachmentId}/inspection`, { method: "POST", headers: { "idempotency-key": session.attachmentId } });
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const job = await api<{ status: string }>(`/jobs/${inspection.id}`);
        if (job.status === "succeeded") break;
        if (job.status === "failed") throw new Error("文件检查失败");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      const latest = await api<{ id: string } | null>(`/trips/${tripId}/imports/latest`);
      if (!latest?.id) throw new Error("检查完成但未生成 ImportJob");
      setImportJobId(latest.id);
      const [loadedMapping, loadedPreview] = await Promise.all([api<{ mapping: Record<string, string> }>(`/imports/${latest.id}/mapping`).catch(() => null), api<{ rows: PreviewRow[] }>(`/imports/${latest.id}/preview`).catch(() => null)]);
      if (loadedMapping && Object.keys(loadedMapping.mapping).length > 0) {
        setMappingRows((rows) => rows.map((row) => ({ ...row, target: loadedMapping.mapping[row.source] ?? "" })));
      }
      if (loadedPreview) setPreviewRows(loadedPreview.rows);
      setPreviewJobMissing(false);
      setImportStatus(`已生成真实 ImportJob：${latest.id}`);
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "导入失败");
    } finally {
      event.target.value = "";
    }
  }

  return <div className="tripWorkspace">
    <ItineraryPanel tripId={tripId} onTransportModesChange={setTripTransportModes} />
    {actualLocated.length > 0 ? <RealRouteMap transportModes={tripTransportModes} items={actualLocated.map(({ item, point }, index) => ({ id: item.id, dayId: `day-${item.dayNumber}`, dayNumber: item.dayNumber ?? 1, dayColor: "#2563eb", label: item.target, point: { ...point, crs: "WGS84" }, ...(index > 0 && item.transportModeCode !== undefined ? { transportModeCode: item.transportModeCode } : {}) }))} onSelect={(id) => selectionStore.selectFromMarker(id)} /> : null}
    <section aria-label="路线地图" className="workspaceCard routeWorkspace">
      <header><h2>路线与时间线</h2><p>点击路线点或时间线项目，两个视图会保持同一选中状态。</p></header>
      <div className="routeLayout">
        <svg viewBox="0 0 400 220" role="img" aria-label="路线示意图" className="routeMap">
          {located.slice(1).map(({ item, point }, index) => {
            const from = located[index]?.point;
            if (!from) return null;
            const start = svgPoint(from); const end = svgPoint(point);
            const modeCode = item.transportModeCode ?? null;
            const customMode = tripTransportModes.find(({ code }) => code === modeCode);
            const style = routeStyle({ modeCode, quality: "approximate", ...(customMode ? { customMode } : {}) });
            return <line key={`${located[index]?.item.id}-${item.id}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={style.color} strokeDasharray={style.dasharray.join(" ")} strokeWidth={4} data-route-mode={style.label} />;
          })}
          {located.map(({ item, point }) => { const position = svgPoint(point); return <circle key={item.id} cx={position.x} cy={position.y} r={selectedId === item.id ? 9 : 6} tabIndex={0} role="button" aria-label={`地图点 ${item.target}`} aria-pressed={selectedId === item.id} fill={selectedId === item.id ? "#d9485f" : "#2563eb"} onClick={() => selectionStore.selectFromMarker(item.id)} onKeyDown={(event) => { if (event.key === "Enter") selectionStore.selectFromMarker(item.id); }} />; })}
        </svg>
        <ol aria-label="行程时间线" className="workspaceTimeline">{items.map((item) => <li key={item.id}><button type="button" aria-pressed={selectedId === item.id} data-selected={selectedId === item.id} onClick={() => selectionStore.selectFromTimeline(item.id, `day-${item.dayNumber}`)}>{item.target}</button></li>)}</ol>
      </div>
      {selectedId ? <p role="status">当前选择：{items.find(({ id }) => id === selectedId)?.target ?? selectedId}</p> : null}
    </section>

    <section aria-label="费用工作台" className="workspaceCard"><header><h2>费用统计</h2><p>费用保存后重新读取真实 API 汇总。</p></header>{summary ? <CostSummaryPanel summary={summary} budget={null} /> : <p>正在载入费用…</p>}{expenseError ? <p role="alert">{expenseError}</p> : null}<form aria-label="新增费用" onSubmit={(event) => void addExpense(event)} className="expenseForm"><input name="amount" aria-label="金额" placeholder="金额" required /><select name="currency" aria-label="币种" defaultValue="CNY"><option>CNY</option><option>USD</option></select><select name="category" aria-label="费用类别" defaultValue="DINING"><option>DINING</option><option>TRANSPORT</option><option>TICKET</option></select><button type="submit">添加费用</button></form></section>

    <section aria-label="导入映射工作台" className="workspaceCard"><label>上传行程文件<input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void uploadImport(event)} /></label>{importStatus ? <p role="status">{importStatus}</p> : null}{importJobId ? <><MappingEditor rows={mappingRows} errors={[]} onChange={(source, target) => setMappingRows((rows) => rows.map((row) => row.source === source ? { ...row, target } : row))} onSave={saveMapping} />{mappingSaved ? <p role="status">映射已保存，可刷新后恢复。</p> : null}</> : <p role="status">暂无真实导入任务，请先上传并检查文件。</p>}</section>
    <section aria-label="导入预览工作台" className="workspaceCard">{previewJobMissing && previewRows.length === 0 ? <p role="status">暂无真实导入任务，上传并检查文件后可预览。</p> : <PreviewStates rows={previewRows} onSkipErrors={(ids) => void skipPreview(ids)} />}</section>
    {items[0] ? <section aria-label="图片工作台" className="workspaceCard"><TripGallery tripId={tripId} itemId={items[0].id} /></section> : null}
  </div>;
}
