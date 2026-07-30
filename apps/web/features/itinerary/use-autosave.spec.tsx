import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ItemEditor } from "../../src/features/itinerary/item-editor.js";
import { ItineraryAutosave } from "../../src/features/itinerary/use-autosave.js";

describe("TC-B08-01 debounced autosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("coalesces rapid field edits and reports saved only after server success", async () => {
    const response = deferred<ReturnType<typeof savedItem>>();
    const saveItem = vi.fn(() => response.promise);
    const editor = existingEditor();
    const autosave = new ItineraryAutosave(editor, { saveItem }, {
      debounceMs: 300,
    });

    autosave.update({ target: "外" });
    await vi.advanceTimersByTimeAsync(100);
    autosave.update({ target: "外滩", notes: "清晨抵达" });
    expect(autosave.state).toMatchObject({
      status: "dirty",
      dirtyFields: ["target", "notes"],
    });

    await vi.advanceTimersByTimeAsync(299);
    expect(saveItem).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(saveItem).toHaveBeenCalledOnce();
    expect(saveItem.mock.calls[0]?.[0]).toMatchObject({
      target: "外滩",
      notes: "清晨抵达",
    });
    expect(autosave.state.status).toBe("saving");
    expect(autosave.statusText()).toBe("正在保存…");

    response.resolve(savedItem(8, "外滩"));
    await vi.runAllTimersAsync();
    expect(autosave.state).toMatchObject({
      status: "saved",
      confirmedVersion: 8,
      dirtyFields: [],
      retryAvailable: false,
    });
    expect(autosave.statusText()).toBe("已保存");
  });
});

function existingEditor(): ItemEditor {
  return new ItemEditor({
    tripId: "trip-1",
    dayId: "day-1",
    kind: "attraction",
    itemId: "item-1",
    version: 7,
    initial: { target: "外滩旧稿", notes: "" },
  });
}

function savedItem(version: number, target: string) {
  return {
    id: "item-1",
    version,
    tripDayId: "day-1",
    kind: "attraction" as const,
    target,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
