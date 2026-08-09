// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { PreviewStates, ServerImportPreview } from "../../src/features/imports/preview/preview-states";
import { type PreviewRow } from "../../src/features/imports/preview/preview-model";

const rows: PreviewRow[] = Array.from({ length: 3 }, (_, index) => ({ id: String(index + 1), sheetName: "Sheet 1", rowNumber: index + 1, sourceRowKey: `Sheet 1:${index + 1}`, status: index === 0 ? "error" : "new", rawData: { Target: index === 0 ? "" : `事项${index}` }, normalizedData: {}, errors: index === 0 ? [{ field: "Target", message: "必填" }] : [] }));

describe("TC-E05-02 pagination/status-change/skip confirmation", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  test("shows counts, row-level errors and explicit skip action", async () => {
    const user = userEvent.setup();
    const onSkipErrors = vi.fn();
    render(<PreviewStates rows={rows} onSkipErrors={onSkipErrors} />);
    expect(screen.getByText("导入预览，尚未写入正式行程")).toBeTruthy();
    expect(screen.getByText("Target: 必填")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /确认跳过当前页错误/ }));
    expect(onSkipErrors).toHaveBeenCalledWith(["1"]);
  });

  test("limits rendered rows to a page window", () => {
    const many = Array.from({ length: 5000 }, (_, index) => ({ ...rows[1]!, id: String(index + 1), rowNumber: index + 1 }));
    render(<PreviewStates rows={many} onSkipErrors={vi.fn()} />);
    expect(screen.getAllByRole("row")).toHaveLength(51);
  });

  test("uses server filters and persists skipped rows before reloading", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") return new Response(JSON.stringify({ jobId: "job", skipped: ["1"] }), { status: 200 });
      const errorSelected = new URL(url).searchParams.get("status") === "error";
      return new Response(JSON.stringify({
        rows: errorSelected ? rows.slice(0, 1) : rows,
        counts: { total: 3, new: 2, update: 0, duplicate: 0, error: 1, unresolved: 0, skipped: 0 },
        filteredTotal: errorSelected ? 1 : 3,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServerImportPreview jobId="job" />);
    await screen.findByText("Target: 必填");
    await user.click(screen.getByRole("button", { name: "error 1" }));
    await screen.findByText("第 1 / 1 页，共 1 行");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("status=error"))).toBe(true);
    await user.click(screen.getByRole("button", { name: /跳过当前页错误/ }));
    expect(screen.getByRole("alertdialog", { name: "确认跳过错误行" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "确认跳过" }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method !== "POST").length).toBeGreaterThanOrEqual(3);
  });
});
