// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { MappingEditor } from "./mapping-editor";

describe("E03 editable mapping", () => {
  test("shows source samples, explanation and blocking errors", () => {
    render(<MappingEditor rows={[{ source: "事项", target: "Target", sample: "抵达", candidates: [{ target: "Target", score: 1, explanation: "表头别名匹配" }] }]} errors={[{ code: "TARGET_DUPLICATE", message: "目标字段重复" }]} onChange={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText("抵达")).toBeTruthy();
    expect(screen.getByText("表头别名匹配")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("目标字段重复");
  });
});
