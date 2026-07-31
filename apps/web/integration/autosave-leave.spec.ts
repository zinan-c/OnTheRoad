import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { LeaveGuard } from "../src/components/leave-guard.js";
import {
  ItemEditor,
  type EditorPayload,
} from "../src/features/itinerary/item-editor.js";
import { ItineraryAutosave } from "../src/features/itinerary/use-autosave.js";
import type { TimelineItem } from "../src/features/itinerary/workspace.js";

describe("TC-B08-03 leave and re-enter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("prompts while dirty and re-enters with the last confirmed value after save", async () => {
    const gateway = new MemoryGateway();
    const editor = editorFor(gateway.record);
    const autosave = new ItineraryAutosave(editor, gateway, { debounceMs: 250 });
    const guard = new LeaveGuard(() => autosave.hasUnsavedChanges());
    const confirmLeave = vi.fn(() => false);

    autosave.update({ target: "外滩日出", notes: "带相机" });
    expect(guard.requestLeave(confirmLeave)).toBe(false);
    expect(confirmLeave).toHaveBeenCalledWith("有尚未保存的更改，确定离开吗？");

    const event = { preventDefault: vi.fn(), returnValue: true as string | boolean };
    expect(guard.handleBeforeUnload(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe("");

    await vi.advanceTimersByTimeAsync(250);
    await vi.runAllTimersAsync();
    expect(autosave.state.status).toBe("saved");
    expect(guard.shouldPrompt()).toBe(false);
    expect(guard.requestLeave(confirmLeave)).toBe(true);

    const reentered = editorFor(gateway.record);
    expect(reentered.draft).toMatchObject({
      target: "外滩日出",
      notes: "带相机",
    });
    expect(reentered.version).toBe(2);
  });

  test("upload and large-edit work independently from autosave dirty state", () => {
    const guard = new LeaveGuard(() => false);
    guard.setUploadInProgress(true);
    expect(guard.reasons()).toEqual(["upload"]);
    expect(guard.message()).toContain("上传仍在进行");

    guard.setUploadInProgress(false);
    guard.setLargeEditInProgress(true);
    expect(guard.reasons()).toEqual(["large-edit"]);
    expect(guard.requestLeave(() => true)).toBe(true);

    guard.setLargeEditInProgress(false);
    expect(guard.shouldPrompt()).toBe(false);
  });
});

class MemoryGateway {
  record: TimelineItem = {
    id: "item-1",
    version: 1,
    tripDayId: "day-1",
    kind: "attraction",
    target: "外滩旧稿",
    notes: "",
  };

  async saveItem(
    payload: EditorPayload,
    context: { itemId?: string; version?: number },
  ): Promise<TimelineItem> {
    if (context.itemId !== this.record.id || context.version !== this.record.version) {
      throw Object.assign(new Error("version conflict"), { status: 409 });
    }
    this.record = {
      ...this.record,
      version: this.record.version + 1,
      target: payload.target,
      notes: payload.notes ?? "",
    };
    return structuredClone(this.record);
  }
}

function editorFor(item: TimelineItem): ItemEditor {
  return new ItemEditor({
    tripId: "trip-1",
    dayId: item.tripDayId,
    kind: item.kind,
    itemId: item.id,
    version: item.version,
    initial: {
      target: item.target,
      notes: item.notes ?? "",
    },
  });
}
