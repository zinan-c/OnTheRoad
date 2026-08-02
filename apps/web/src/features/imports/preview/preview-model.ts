export const PREVIEW_STATUSES = Object.freeze(["new", "update", "duplicate", "error", "unresolved", "skipped"] as const);
export type PreviewStatus = typeof PREVIEW_STATUSES[number];

export type PreviewRow = {
  readonly id: string;
  readonly sheetName: string;
  readonly rowNumber: number;
  readonly sourceRowKey: string;
  readonly status: PreviewStatus;
  readonly rawData: Record<string, unknown>;
  readonly normalizedData?: Record<string, unknown>;
  readonly errors: readonly { readonly field: string; readonly message: string }[];
};

export type PreviewCounts = { readonly total: number } & Record<PreviewStatus, number>;

export function buildPreviewCounts(rows: readonly PreviewRow[]): PreviewCounts {
  const counts = Object.fromEntries(PREVIEW_STATUSES.map((status) => [status, 0])) as Record<PreviewStatus, number>;
  for (const row of rows) counts[row.status] += 1;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total !== rows.length) throw new Error("PREVIEW_COUNT_INVARIANT_FAILED");
  return { total, ...counts };
}

export function filterPreviewRows(rows: readonly PreviewRow[], status: PreviewStatus | "all", query = ""): PreviewRow[] {
  const needle = query.trim().toLocaleLowerCase("en-US");
  return rows.filter((row) => {
    if (status !== "all" && row.status !== status) return false;
    if (!needle) return true;
    return `${row.sheetName} ${row.rowNumber} ${row.sourceRowKey} ${Object.values(row.rawData).join(" ")}`.toLocaleLowerCase("en-US").includes(needle);
  });
}

export function paginatePreviewRows(rows: readonly PreviewRow[], page: number, pageSize = 50) {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1) throw new RangeError("page and pageSize must be positive integers");
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  return { items: rows.slice((safePage - 1) * pageSize, safePage * pageSize), page: safePage, pageSize, total: rows.length, totalPages };
}

export function rowAction(row: Pick<PreviewRow, "status">): string {
  return row.status === "error" ? "需修正" : row.status === "skipped" ? "已跳过" : row.status === "unresolved" ? "待确认" : row.status === "duplicate" ? "重复" : row.status === "update" ? "更新" : "新增";
}

export function skipErrorRows(rows: readonly PreviewRow[], rowIds: readonly string[], confirmed: boolean): PreviewRow[] {
  if (!confirmed) throw new Error("PREVIEW_SKIP_CONFIRMATION_REQUIRED");
  const selected = new Set(rowIds);
  return rows.map((row) => selected.has(row.id) && row.status === "error" ? { ...row, status: "skipped" } : row);
}

export function previewStageLabel(): string {
  return "导入预览，尚未写入正式行程";
}
