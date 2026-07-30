import { describe, expect, test, vi } from "vitest";

import {
  ItineraryWorkspace,
  renderWorkspace,
} from "../../src/features/itinerary/workspace.js";

const days = [
  { id: "day-1", dayNumber: 1, date: "2026-10-01", destination: "上海" },
  { id: "day-2", dayNumber: 2, date: "2026-10-02", destination: "舟山" },
];

describe("TC-B06-02 empty/error/conflict accessibility", () => {
  test("empty and slow states are sourced from the gateway and remain recoverable", async () => {
    let resolveLoad!: (items: []) => void;
    const loadItems = vi.fn(
      () => new Promise<[]>((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const workspace = new ItineraryWorkspace({ listDays: async () => days, loadItems });

    const loading = workspace.load("trip-1");
    expect(workspace.state.loading).toBe(true);
    expect(renderWorkspace(workspace.state, 1_280)).toContain('role="status"');
    expect(renderWorkspace(workspace.state, 1_280)).toContain("正在加载当天行程");

    await Promise.resolve();
    resolveLoad([]);
    await loading;
    const empty = renderWorkspace(workspace.state, 1_280);
    expect(empty).toContain("这一天还没有行程");
    expect(empty).toContain('aria-label="新增行程事项"');
    expect(empty).toContain('data-layout="desktop"');
  });

  test("server field errors and 409 preserve the draft with accessible recovery actions", async () => {
    let attempt = 0;
    const workspace = new ItineraryWorkspace({
      listDays: async () => days,
      loadItems: async () => [],
      async saveItem() {
        attempt += 1;
        if (attempt === 1) {
          throw Object.assign(new Error("字段校验失败"), {
            status: 422,
            fieldErrors: { target: "请输入事项名称" },
          });
        }
        throw Object.assign(new Error("版本冲突"), { status: 409 });
      },
    });
    await workspace.load("trip-1");
    workspace.beginCreate("activity");
    workspace.editor?.update({ target: "服务端拒绝", notes: "不要丢失" });

    await expect(workspace.save()).rejects.toThrow(/字段校验/);
    let html = renderWorkspace(workspace.state, 390);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="target-error"');
    expect(html).toContain('id="target-error"');

    workspace.editor?.update({ target: "外滩散步" });
    await expect(workspace.save()).rejects.toThrow(/版本冲突/);
    expect(workspace.state.conflict).toBe(true);
    expect(workspace.editor?.draft.notes).toBe("不要丢失");
    html = renderWorkspace(workspace.state, 390);
    expect(html).toContain('role="alert"');
    expect(html).toContain("重新载入");
    expect(html).toContain("保留草稿");
  });

  test("keyboard navigation reaches days, timeline, editor, save and mobile tabs", async () => {
    const workspace = new ItineraryWorkspace({
      listDays: async () => days,
      loadItems: async () => [],
    });
    await workspace.load("trip-1");
    expect(workspace.keyboardOrder()).toEqual([
      "day-day-1",
      "day-day-2",
      "add-item",
      "mobile-itinerary",
      "mobile-map",
      "mobile-day",
    ]);
    expect(await workspace.handleKey("ArrowDown", "day-day-1")).toBe("day-day-2");
    workspace.beginCreate("activity");
    expect(workspace.keyboardOrder()).toContain("editor-save");
    expect(
      await workspace.handleKey("ArrowDown", "editor-target"),
    ).toBe("editor-start-time");
    expect(await workspace.handleKey("Escape", "editor-target")).toBe("add-item");
    expect(workspace.editor).toBeNull();
  });
});
