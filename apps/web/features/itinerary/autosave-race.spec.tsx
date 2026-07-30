import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ItemEditor } from "../../src/features/itinerary/item-editor.js";
import { ItineraryAutosave } from "../../src/features/itinerary/use-autosave.js";

describe("TC-B08-02 out-of-order/offline/conflict", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("a stale response cannot overwrite the newer value or confirmed version", async () => {
    const first = deferred<Item>();
    const second = deferred<Item>();
    const saveItem = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const editor = existingEditor();
    const autosave = new ItineraryAutosave(editor, { saveItem }, {
      debounceMs: 200,
    });

    autosave.update({ target: "A" });
    await vi.advanceTimersByTimeAsync(200);
    autosave.update({ target: "B" });
    await vi.advanceTimersByTimeAsync(200);
    expect(saveItem).toHaveBeenCalledTimes(2);

    second.resolve(item(12, "B"));
    await vi.runAllTimersAsync();
    expect(autosave.state).toMatchObject({
      status: "saved",
      confirmedVersion: 12,
    });

    first.resolve(item(11, "A"));
    await vi.runAllTimersAsync();
    expect(editor.draft.target).toBe("B");
    expect(autosave.state).toMatchObject({
      status: "saved",
      confirmedVersion: 12,
      dirtyFields: [],
    });
  });

  test.each([
    [Object.assign(new Error("offline"), { status: 0 }), false, "网络不可用"],
    [Object.assign(new Error("version conflict"), { status: 409 }), true, "版本冲突"],
  ])("retains input and exposes explicit retry for %s", async (
    failure,
    conflict,
    message,
  ) => {
    const saveItem = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(item(9, "保留的输入"));
    const editor = existingEditor();
    const autosave = new ItineraryAutosave(editor, { saveItem }, {
      debounceMs: 100,
    });

    autosave.update({ target: "保留的输入" });
    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTimersAsync();
    expect(autosave.state).toMatchObject({
      status: conflict ? "conflict" : "error",
      retryAvailable: true,
      conflict,
      error: message,
      dirtyFields: ["target"],
    });
    expect(editor.draft.target).toBe("保留的输入");

    await autosave.retry();
    expect(saveItem).toHaveBeenCalledTimes(2);
    expect(autosave.state).toMatchObject({
      status: "saved",
      confirmedVersion: 9,
      retryAvailable: false,
    });
  });

  test("ignores a pending response after disposal", async () => {
    const response = deferred<Item>();
    const autosave = new ItineraryAutosave(existingEditor(), {
      saveItem: () => response.promise,
    }, { debounceMs: 50 });
    autosave.update({ notes: "页面即将卸载" });
    await vi.advanceTimersByTimeAsync(50);
    autosave.dispose();
    response.resolve(item(10, "外滩旧稿"));
    await vi.runAllTimersAsync();
    expect(autosave.state.status).toBe("disposed");
  });
});

type Item = ReturnType<typeof item>;

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

function item(version: number, target: string) {
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
