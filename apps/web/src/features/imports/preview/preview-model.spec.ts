import { describe, expect, test } from "vitest";

import { buildPreviewCounts, filterPreviewRows, paginatePreviewRows, previewStageLabel, rowAction, skipErrorRows, type PreviewRow } from "./preview-model";

const row = (id: string, status: PreviewRow["status"], target = id): PreviewRow => ({ id, sheetName: "Sheet 1", rowNumber: Number(id), sourceRowKey: `Sheet 1:${id}`, status, rawData: { Target: target }, errors: status === "error" ? [{ field: "Target", message: "必填" }] : [] });

describe("E05 preview model", () => {
  test("keeps the category count invariant and filters/paginates deterministically", () => {
    const rows = [row("1", "new"), row("2", "update"), row("3", "duplicate"), row("4", "error"), row("5", "unresolved"), row("6", "skipped")];
    expect(buildPreviewCounts(rows)).toEqual({ total: 6, new: 1, update: 1, duplicate: 1, error: 1, unresolved: 1, skipped: 1 });
    expect(filterPreviewRows(rows, "error")).toHaveLength(1);
    expect(paginatePreviewRows([...rows, ...rows], 2, 4).items.map(({ id }) => id)).toEqual(["5", "6", "1", "2"]);
  });

  test("requires explicit confirmation before skipping errors and never claims imported", () => {
    const rows = [row("1", "error"), row("2", "new")];
    expect(() => skipErrorRows(rows, ["1"], false)).toThrow("PREVIEW_SKIP_CONFIRMATION_REQUIRED");
    expect(skipErrorRows(rows, ["1"], true)[0]?.status).toBe("skipped");
    expect(rowAction(row("1", "error"))).toBe("需修正");
    expect(previewStageLabel()).toContain("尚未写入");
  });
});
