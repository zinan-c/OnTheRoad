"use client";

import { useMemo, useState } from "react";

import { buildPreviewCounts, filterPreviewRows, paginatePreviewRows, previewStageLabel, rowAction, type PreviewRow, type PreviewStatus } from "./preview-model";

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

function stringify(value: Record<string, unknown>): string {
  const result = Object.entries(value).map(([key, item]) => `${key}: ${String(item ?? "")}`).join(" · ");
  return result.length > 500 ? `${result.slice(0, 500)}…` : result;
}
