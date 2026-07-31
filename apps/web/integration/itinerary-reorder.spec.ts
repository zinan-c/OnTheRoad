import { describe, expect, test } from "vitest";

import {
  SortableTimelineController,
  SortableTimelineInputAdapter,
  dndKitSensorBlueprints,
  dndKitTransformStyle,
  renderSortableTimeline,
  touchActionFor,
  type ReorderRequest,
  type SortableTimelineGateway,
  type SortableTimelineItem,
} from "../src/features/itinerary/components/sortable-timeline.js";

class PersistentOrderGateway implements SortableTimelineGateway {
  readonly requests: ReorderRequest[] = [];
  orderedIds = ["a", "b", "c"];
  version = 1;
  failNext = false;
  releaseFailure: (() => void) | null = null;

  async reorder(request: ReorderRequest) {
    this.requests.push(structuredClone(request));
    if (this.failNext) {
      this.failNext = false;
      await new Promise<void>((resolve) => {
        this.releaseFailure = resolve;
      });
      throw new Error("network unavailable");
    }
    if (request.baseVersion !== this.version) {
      throw Object.assign(new Error("version conflict"), { status: 409 });
    }
    this.orderedIds = [...request.orderedIds];
    this.version += 1;
    return {
      tripDayId: request.tripDayId,
      version: this.version,
      orderedIds: [...this.orderedIds],
      eventId: `event-${this.version}`,
    };
  }
}

const allItems: SortableTimelineItem[] = [
  { id: "a", target: "外滩" },
  { id: "b", target: "午餐" },
  { id: "c", target: "码头" },
];

function itemsFor(ids: string[]): SortableTimelineItem[] {
  const byId = new Map(allItems.map((item) => [item.id, item]));
  return ids.map((id) => structuredClone(byId.get(id)!));
}

describe("TC-B07-03 Mouse, touch, and keyboard reorder", () => {
  test("wires dnd-kit pointer, touch, keyboard, sortable, and transform primitives", () => {
    expect(dndKitSensorBlueprints.map(({ sensor }) => sensor.name)).toEqual([
      "PointerSensor",
      "TouchSensor",
      "KeyboardSensor",
    ]);
    expect(dndKitTransformStyle({
      x: 12,
      y: -4,
      scaleX: 1,
      scaleY: 1,
    })).toContain("translate3d(12px, -4px, 0)");
  });

  test("three equivalent inputs persist complete arrays and reload in the saved order", async () => {
    const gateway = new PersistentOrderGateway();
    const timeline = new SortableTimelineController({
      tripDayId: "day-1",
      dayVersion: 1,
      items: itemsFor(gateway.orderedIds),
      gateway,
    });
    const input = new SortableTimelineInputAdapter(timeline);

    await input.dragEnd({
      active: { id: "c" },
      over: { id: "a" },
      activatorEvent: { type: "pointerup", pointerType: "mouse" },
    });
    expect(timeline.state.items.map(({ id }) => id)).toEqual(["c", "a", "b"]);
    await input.dragEnd({
      active: { id: "a" },
      over: { id: "b" },
      activatorEvent: { type: "touchend", pointerType: "touch" },
    });
    expect(timeline.state.items.map(({ id }) => id)).toEqual(["c", "b", "a"]);
    await input.keyboardMove("c", "down");
    expect(timeline.state.items.map(({ id }) => id)).toEqual(["b", "c", "a"]);

    expect(gateway.requests).toEqual([
      {
        tripDayId: "day-1",
        baseVersion: 1,
        orderedIds: ["c", "a", "b"],
      },
      {
        tripDayId: "day-1",
        baseVersion: 2,
        orderedIds: ["c", "b", "a"],
      },
      {
        tripDayId: "day-1",
        baseVersion: 3,
        orderedIds: ["b", "c", "a"],
      },
    ]);
    expect(gateway.orderedIds).toEqual(["b", "c", "a"]);
    const reloaded = new SortableTimelineController({
      tripDayId: "day-1",
      dayVersion: gateway.version,
      items: itemsFor(gateway.orderedIds),
      gateway,
    });
    expect(reloaded.state.items.map(({ id }) => id)).toEqual(["b", "c", "a"]);
    expect(reloaded.state.dayVersion).toBe(4);
  });

  test("optimistic order rolls back on save failure and exposes accessible recovery state", async () => {
    const gateway = new PersistentOrderGateway();
    const timeline = new SortableTimelineController({
      tripDayId: "day-1",
      dayVersion: 1,
      items: itemsFor(gateway.orderedIds),
      gateway,
    });
    gateway.failNext = true;

    const saving = timeline.reorderByTouch("c", "a");
    expect(timeline.state.items.map(({ id }) => id)).toEqual(["c", "a", "b"]);
    expect(timeline.state.saving).toBe(true);
    gateway.releaseFailure?.();
    await expect(saving).rejects.toThrow(/network unavailable/u);

    expect(timeline.state.items.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(timeline.state.dayVersion).toBe(1);
    expect(timeline.state.announcement).toContain("已恢复原顺序");
    const html = renderSortableTimeline(timeline.state);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-keyboard-move="up"');
    expect(touchActionFor("drag-handle")).toBe("none");
    expect(touchActionFor("timeline-content")).toBe("pan-y");
  });
});
