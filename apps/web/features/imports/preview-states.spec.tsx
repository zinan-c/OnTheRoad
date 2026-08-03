// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { PreviewStates } from "../../src/features/imports/preview/preview-states";
import { type PreviewRow } from "../../src/features/imports/preview/preview-model";

const rows: PreviewRow[] = Array.from({ length: 3 }, (_, index) => ({ id: String(index + 1), sheetName: "Sheet 1", rowNumber: index + 1, sourceRowKey: `Sheet 1:${index + 1}`, status: index === 0 ? "error" : "new", rawData: { Target: index === 0 ? "" : `事项${index}` }, normalizedData: {}, errors: index === 0 ? [{ field: "Target", message: "必填" }] : [] }));

describe("TC-E05-02 pagination/status-change/skip confirmation", () => {
  afterEach(() => cleanup());
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
});
