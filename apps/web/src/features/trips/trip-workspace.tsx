"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { MappingEditor, type MappingRow } from "../imports/mapping/mapping-editor";
import { ServerImportPreview } from "../imports/preview/preview-states";
import { ExpenseWorkspace } from "../expenses/expense-workspace";
import { RouteMapWorkspace } from "../map/route-map-workspace";
import { TripGalleryWorkspace } from "../attachments/trip-gallery";
import { ItineraryPanel, type ProductItem } from "../itinerary/itinerary-panel";
import type { TransportModeView } from "./settings/transport-modes";
import { useReferenceData } from "../reference-data/use-reference-data";

type Item = { readonly id: string; readonly target: string; readonly dayNumber?: number; readonly locationId?: string | null; readonly transportModeCode?: string | null };
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

type MappingPayload = {
  readonly mapping: Record<string, string>;
  readonly sourceColumns: readonly string[];
  readonly sheetNames: readonly string[];
  readonly sampleRows: readonly Record<string, unknown>[];
  readonly suggestions: readonly { source: string; candidates: MappingRow["candidates"] }[];
};

function mappingRowsFrom(payload: MappingPayload): MappingRow[] {
  return payload.suggestions.map(({ source, candidates }) => ({
    source,
    target: payload.mapping[source] ?? candidates[0]?.target ?? "",
    sample: String(payload.sampleRows.find((row) => row[source] !== undefined)?.[source] ?? ""),
    candidates,
  }));
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
  const referenceData = useReferenceData();
  const [days, setDays] = useState<Day[]>([]);
  const [mappingRows, setMappingRows] = useState<MappingRow[]>([]);
  const [mappingSheetNames, setMappingSheetNames] = useState<readonly string[]>([]);
  const [mappingSaved, setMappingSaved] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [tripTransportModes, setTripTransportModes] = useState<TransportModeView[]>([]);

  useEffect(() => {
    void (async () => {
      const [loadedDays, latest, loadedTransportModes] = await Promise.all([api<Day[]>(`/trips/${tripId}/days`).then(async (loaded) => Promise.all(loaded.map(async (day) => ({ ...day, items: await api<Item[]>(`/trips/${tripId}/days/${day.id}/itinerary-items`) })))), api<{ id: string } | null>(`/trips/${tripId}/imports/latest`).catch(() => null), api<TransportModeView[]>(`/trips/${tripId}/transport-modes`).catch(() => [])]);
      const jobId = latest?.id ?? null;
      const loadedMapping = jobId ? await api<MappingPayload>(`/imports/${jobId}/mapping`).catch(() => null) : null;
      setImportJobId(jobId);
      setDays(loadedDays);
      setTripTransportModes(loadedTransportModes);
      if (loadedMapping) {
        setMappingRows(mappingRowsFrom(loadedMapping));
        setMappingSheetNames(loadedMapping.sheetNames);
      }
    })();
  }, [tripId]);

  const items = useMemo(() => flattenDays(days), [days]);
  const handleItemsChange = useCallback((dayId: string, loadedItems: ProductItem[]) => {
    const workspaceItems = loadedItems.map((item) => ({ ...item, target: item.target ?? item.description ?? "未命名事项" }));
    setDays((current) => current.map((day) => day.id === dayId ? { ...day, items: workspaceItems } : day));
  }, []);

  async function saveMapping() {
    if (!importJobId) return;
    const saved = await api(`/imports/${importJobId}/mapping`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mapping: Object.fromEntries(mappingRows.filter(({ target }) => target).map(({ source, target }) => [source, target])), sourceColumns: mappingRows.map(({ source }) => source), requiredTargets: ["Target"], sheetNames: mappingSheetNames }) });
    let previewReady = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const latest = await api<{ status: string } | null>(`/trips/${tripId}/imports/latest`);
      if (latest?.status === "confirmation_required") {
        previewReady = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!previewReady) throw new Error("服务端 Preview 生成超时，请重试保存映射。");
    setMappingSaved(Boolean(saved));
    setPreviewRevision((value) => value + 1);
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
      const loadedMapping = await api<MappingPayload>(`/imports/${latest.id}/mapping`);
      if (loadedMapping) {
        setMappingRows(mappingRowsFrom(loadedMapping));
        setMappingSheetNames(loadedMapping.sheetNames);
      }
      setImportStatus(`已生成真实 ImportJob：${latest.id}`);
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "导入失败");
    } finally {
      event.target.value = "";
    }
  }

  return <div className="tripWorkspace">
    <ItineraryPanel tripId={tripId} onTransportModesChange={setTripTransportModes} onItemsChange={handleItemsChange} />
    <RouteMapWorkspace tripId={tripId} transportModes={tripTransportModes} />

    <ExpenseWorkspace tripId={tripId} items={items} />

    <section aria-label="导入映射工作台" className="workspaceCard"><label>上传行程文件<input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void uploadImport(event)} /></label><p className="status">导入币种规范使用统一 Reference Data：{referenceData.currencies.length} 个币种；{Object.entries(referenceData.currencyAliases).map(([alias, code]) => `${alias}→${code}`).join("、")}</p>{importStatus ? <p role="status">{importStatus}</p> : null}{importJobId ? <><MappingEditor rows={mappingRows} errors={[]} onChange={(source, target) => setMappingRows((rows) => rows.map((row) => row.source === source ? { ...row, target } : row))} onSave={saveMapping} />{mappingSaved ? <p role="status">映射已保存，可刷新后恢复。</p> : null}</> : <p role="status">暂无真实导入任务，请先上传并检查文件。</p>}</section>
    <section aria-label="导入预览工作台" className="workspaceCard">{importJobId ? <ServerImportPreview jobId={importJobId} refreshKey={previewRevision} /> : <p role="status">暂无真实导入任务，上传并检查文件后可预览。</p>}</section>
    <TripGalleryWorkspace tripId={tripId} items={items} />
  </div>;
}
