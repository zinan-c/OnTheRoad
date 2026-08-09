"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { buildPreviewCounts, filterPreviewRows, paginatePreviewRows, previewStageLabel, rowAction, type PreviewRow, type PreviewStatus } from "./preview-model";

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";

export function PreviewStates({ rows, onSkipErrors }: { readonly rows: readonly PreviewRow[]; readonly onSkipErrors: (ids: readonly string[]) => void }) {
  const [status, setStatus] = useState<PreviewStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => filterPreviewRows(rows, status, query), [rows, status, query]);
  const pageData = paginatePreviewRows(filtered, page, 50);
  const counts = buildPreviewCounts(rows);
  const errorIds = pageData.items.filter(({ status: rowStatus }) => rowStatus === "error").map(({ id }) => id);
  function requestSkip() {
    if (errorIds.length === 0) return;
    onSkipErrors(errorIds);
  }
  return <section aria-label="导入预览" className="previewStates">
    <header><h2>导入预览</h2><p role="status">{previewStageLabel()}</p></header>
    <nav aria-label="预览状态筛选">{(["all", "new", "update", "duplicate", "error", "unresolved", "skipped"] as const).map((value) => <button key={value} type="button" aria-pressed={status === value} onClick={() => { setStatus(value); setPage(1); }}>{value === "all" ? `全部 ${counts.total}` : `${value} ${counts[value]}`}</button>)}</nav>
    <label>搜索源行<input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label>
    {errorIds.length > 0 ? <button type="button" onClick={requestSkip}>确认跳过当前页错误（{errorIds.length}）</button> : null}
    <div className="previewTableScroll"><table><thead><tr><th>行</th><th>状态</th><th>原始值</th><th>规范值</th><th>问题</th></tr></thead><tbody>{pageData.items.map((row) => <tr key={row.id}><td>{row.sourceRowKey}</td><td>{rowAction(row)}</td><td className="previewCell">{stringify(row.rawData)}</td><td className="previewCell">{stringify(row.normalizedData ?? {})}</td><td>{row.errors.map(({ field, message }) => <span key={`${field}-${message}`}>{field}: {message}</span>)}</td></tr>)}</tbody></table></div>
    <footer><button type="button" disabled={pageData.page <= 1} onClick={() => setPage(pageData.page - 1)}>上一页</button><span>第 {pageData.page} / {pageData.totalPages} 页，共 {pageData.total} 行</span><button type="button" disabled={pageData.page >= pageData.totalPages} onClick={() => setPage(pageData.page + 1)}>下一页</button></footer>
  </section>;
}

type ServerPreviewPage = {
  readonly rows: readonly PreviewRow[];
  readonly counts: ReturnType<typeof buildPreviewCounts>;
  readonly filteredTotal: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
};

export function ServerImportPreview({ jobId, refreshKey = 0 }: { readonly jobId: string; readonly refreshKey?: number }) {
  const [status, setStatus] = useState<PreviewStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ServerPreviewPage>();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async (nextPage = page) => {
    const parameters = new URLSearchParams({ status, query, page: String(nextPage), pageSize: "50" });
    const response = await fetch(`${API_ORIGIN}/api/v1/imports/${jobId}/preview?${parameters}`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Preview ${response.status}`);
    setData(await response.json() as ServerPreviewPage);
    setError(undefined);
  }, [jobId, page, query, refreshKey, status]);

  useEffect(() => {
    void load().catch(() => setError("服务端 Preview 载入失败。"));
  }, [load]);

  const errorIds = data?.rows.filter(({ status: rowStatus }) => rowStatus === "error").map(({ id }) => id) ?? [];
  async function skipErrors() {
    const response = await fetch(`${API_ORIGIN}/api/v1/imports/${jobId}/preview/skip`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: errorIds }),
    });
    if (!response.ok) {
      setError("跳过错误行失败。");
      return;
    }
    setConfirming(false);
    await load();
  }

  const counts = data?.counts ?? { total: 0, new: 0, update: 0, duplicate: 0, error: 0, unresolved: 0, skipped: 0 };
  return <section aria-label="服务端导入预览" className="previewStates">
    <header><h2>导入预览</h2><p role="status">{previewStageLabel()}</p></header>
    <nav aria-label="预览状态筛选">{(["all", "new", "update", "duplicate", "error", "unresolved", "skipped"] as const).map((value) => <button key={value} type="button" aria-pressed={status === value} onClick={() => { setStatus(value); setPage(1); }}>{value === "all" ? `全部 ${counts.total}` : `${value} ${counts[value]}`}</button>)}</nav>
    <label>搜索源行<input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label>
    {errorIds.length > 0 ? confirming ? <div role="alertdialog" aria-label="确认跳过错误行"><p>确认把当前页 {errorIds.length} 条 error 标记为 skipped？</p><button type="button" onClick={() => void skipErrors()}>确认跳过</button><button type="button" onClick={() => setConfirming(false)}>取消</button></div> : <button type="button" onClick={() => setConfirming(true)}>跳过当前页错误（{errorIds.length}）</button> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className="previewTableScroll"><table><thead><tr><th>行</th><th>状态</th><th>原始值</th><th>规范值</th><th>问题</th></tr></thead><tbody>{data?.rows.map((row) => <tr key={row.id}><td>{row.sheetName} · {row.rowNumber} · {row.sourceRowKey}</td><td>{rowAction(row)}</td><td className="previewCell">{stringify(row.rawData)}</td><td className="previewCell">{stringify(row.normalizedData ?? {})}</td><td>{row.errors.map(({ field, message }) => <span key={`${field}-${message}`}>{field}: {message}</span>)}</td></tr>)}</tbody></table></div>
    <footer><button type="button" disabled={!data || data.page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><span>第 {data?.page ?? 1} / {data?.totalPages ?? 1} 页，共 {data?.filteredTotal ?? 0} 行</span><button type="button" disabled={!data || data.page >= data.totalPages} onClick={() => setPage((value) => value + 1)}>下一页</button></footer>
  </section>;
}

function stringify(value: Record<string, unknown>): string {
  const result = Object.entries(value).map(([key, item]) => `${key}: ${String(item ?? "")}`).join(" · ");
  return result.length > 500 ? `${result.slice(0, 500)}…` : result;
}
