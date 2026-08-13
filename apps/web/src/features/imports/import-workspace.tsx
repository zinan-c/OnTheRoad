"use client";

import { useEffect, useState } from "react";
import { MappingEditor, type MappingRow } from "./mapping/mapping-editor";
import { ServerImportPreview } from "./preview/preview-states";

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";

type MappingPayload = {
  readonly mapping: Record<string, string>;
  readonly sourceColumns: readonly string[];
  readonly sheetNames: readonly string[];
  readonly sampleRows: readonly Record<string, unknown>[];
  readonly suggestions: readonly {
    readonly source: string;
    readonly candidates: readonly MappingRow["candidates"][number][];
  }[];
  readonly version?: number;
};

type LatestImport = {
  readonly id: string;
  readonly status: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ORIGIN}/api/v1${path}`, {
    ...init,
    cache: "no-store",
    credentials: "include",
    headers: { accept: "application/json", ...init?.headers },
  });
  if (!response.ok) throw new Error(`API ${response.status}: ${path}`);
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

function rowsFromMapping(payload: MappingPayload): MappingRow[] {
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

export function ImportWorkspace({ tripId }: { readonly tripId: string }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [sheetNames, setSheetNames] = useState<readonly string[]>([]);
  const [mappingVersion, setMappingVersion] = useState<number | undefined>();
  const [status, setStatus] = useState<string>();
  const [mappingSaved, setMappingSaved] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const latest = await api<LatestImport | null>(`/trips/${tripId}/imports/latest`).catch(() => null);
      if (!active) return;
      setJobId(latest?.id ?? null);
      if (!latest?.id) return;
      const mapping = await api<MappingPayload>(`/imports/${latest.id}/mapping`).catch(() => null);
      if (!active || !mapping) return;
      setRows(rowsFromMapping(mapping));
      setSheetNames(mapping.sheetNames);
      setMappingVersion(mapping.version);
    })();
    return () => { active = false; };
  }, [tripId]);

  async function uploadImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatus("正在创建上传会话…");
    setMappingSaved(false);
    try {
      const checksumSha256 = digestBase64(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
      const session = await api<{
        attachmentId: string;
        uploadUrl: string;
        headers?: Record<string, string>;
      }>(`/trips/${tripId}/imports/uploads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          contentLength: file.size,
          checksumSha256,
        }),
      });
      setStatus("正在上传文件…");
      const uploaded = await fetch(session.uploadUrl, {
        method: "PUT",
        ...(session.headers ? { headers: session.headers } : {}),
        body: file,
      });
      if (!uploaded.ok) throw new Error(`上传失败：${uploaded.status}`);
      await api(`/trips/${tripId}/imports/${session.attachmentId}/complete`, { method: "POST" });
      setStatus("正在扫描并检查文件…");
      const inspection = await api<{ id: string }>(
        `/trips/${tripId}/imports/${session.attachmentId}/inspection`,
        { method: "POST", headers: { "idempotency-key": session.attachmentId } },
      );
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const job = await api<{ status: string }>(`/jobs/${inspection.id}`);
        if (job.status === "succeeded") break;
        if (job.status === "failed") throw new Error("文件检查失败");
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const latest = await api<LatestImport | null>(`/trips/${tripId}/imports/latest`);
      if (!latest?.id) throw new Error("检查完成但未生成 ImportJob");
      const mapping = await api<MappingPayload>(`/imports/${latest.id}/mapping`);
      setJobId(latest.id);
      setRows(rowsFromMapping(mapping));
      setSheetNames(mapping.sheetNames);
      setMappingVersion(mapping.version);
      setStatus(`已生成真实 ImportJob：${latest.id}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导入失败");
    } finally {
      event.target.value = "";
    }
  }

  async function saveMapping() {
    if (!jobId) return;
    await api(`/imports/${jobId}/mapping`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mapping: Object.fromEntries(rows.filter(({ target }) => target).map(({ source, target }) => [source, target])),
        sourceColumns: rows.map(({ source }) => source),
        requiredTargets: ["Target"],
        sheetNames,
        ...(mappingVersion === undefined ? {} : { expectedVersion: mappingVersion }),
      }),
    });
    setMappingSaved(true);
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const latest = await api<LatestImport | null>(`/trips/${tripId}/imports/latest`);
      if (latest?.status === "confirmation_required" || latest?.status === "ready_to_import") {
        setStatus(latest.status);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return <>
    <section aria-label="导入映射工作台" className="workspaceCard">
      <label>上传行程文件<input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void uploadImport(event)} /></label>
      {status ? <p role="status">{status}</p> : null}
      {jobId ? <>
        <MappingEditor
          rows={rows}
          errors={[]}
          onChange={(source, target) => setRows((current) => current.map((row) => row.source === source ? { ...row, target } : row))}
          onSave={() => void saveMapping()}
        />
        {mappingSaved ? <p role="status">映射已保存，可刷新后恢复。</p> : null}
      </> : <p role="status">暂无真实导入任务，请先上传并检查文件。</p>}
    </section>
    <section aria-label="导入预览工作台" className="workspaceCard">
      {jobId ? <ServerImportPreview jobId={jobId} /> : <p role="status">暂无真实导入任务，上传并检查文件后可预览。</p>}
    </section>
  </>;
}
