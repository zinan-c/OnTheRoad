export type SortableTimelineItem = {
  id: string;
  target: string;
};

export type ReorderRequest = {
  tripDayId: string;
  baseVersion: number;
  orderedIds: string[];
};

export type ReorderResponse = {
  tripDayId: string;
  version: number;
  orderedIds: string[];
  eventId?: string;
};

export type SortableTimelineGateway = {
  reorder: (request: ReorderRequest) => Promise<ReorderResponse>;
};

export type ReorderInputKind = "mouse" | "touch" | "keyboard";

export type DragEndEventLike = Pick<DragEndEvent, "active" | "over" | "activatorEvent">;

export const dndKitSensorBlueprints = Object.freeze([
  {
    sensor: PointerSensor,
    options: { activationConstraint: { distance: 6 } },
  },
  {
    sensor: TouchSensor,
    options: { activationConstraint: { delay: 180, tolerance: 5 } },
  },
  {
    sensor: KeyboardSensor,
    options: { coordinateGetter: sortableKeyboardCoordinates },
  },
]);

export function dndKitTransformStyle(
  transform: Parameters<typeof CSS.Transform.toString>[0],
): string | undefined {
  return CSS.Transform.toString(transform);
}

export type SortableTimelineState = {
  items: SortableTimelineItem[];
  dayVersion: number;
  saving: boolean;
  error: string | null;
  announcement: string;
};

function move(
  items: SortableTimelineItem[],
  activeId: string,
  overId: string,
): SortableTimelineItem[] {
  const from = items.findIndex(({ id }) => id === activeId);
  const to = items.findIndex(({ id }) => id === overId);
  if (from === -1 || to === -1) {
    throw new RangeError("Reorder IDs must belong to the visible Day");
  }
  if (from === to) return [...items];
  return arrayMove(items, from, to);
}

function sameSet(left: string[], right: string[]): boolean {
  return (
    left.length === right.length
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && left.every((id) => right.includes(id))
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "排序保存失败";
}

export class SortableTimelineController {
  readonly state: SortableTimelineState;

  readonly #tripDayId: string;
  readonly #gateway: SortableTimelineGateway;

  constructor(input: {
    tripDayId: string;
    dayVersion: number;
    items: SortableTimelineItem[];
    gateway: SortableTimelineGateway;
  }) {
    if (!Number.isSafeInteger(input.dayVersion) || input.dayVersion < 1) {
      throw new RangeError("dayVersion must be a positive integer");
    }
    if (
      new Set(input.items.map(({ id }) => id)).size !== input.items.length
    ) {
      throw new RangeError("Timeline item IDs must be unique");
    }
    this.#tripDayId = input.tripDayId;
    this.#gateway = input.gateway;
    this.state = {
      items: structuredClone(input.items),
      dayVersion: input.dayVersion,
      saving: false,
      error: null,
      announcement: "",
    };
  }

  reorderByMouse(activeId: string, overId: string): Promise<void> {
    return this.#commit(move(this.state.items, activeId, overId), "mouse");
  }

  reorderByTouch(activeId: string, overId: string): Promise<void> {
    return this.#commit(move(this.state.items, activeId, overId), "touch");
  }

  reorderByKeyboard(
    activeId: string,
    direction: "up" | "down",
  ): Promise<void> {
    const index = this.state.items.findIndex(({ id }) => id === activeId);
    if (index === -1) {
      throw new RangeError("Keyboard reorder ID must belong to the visible Day");
    }
    const targetIndex = Math.max(
      0,
      Math.min(
        this.state.items.length - 1,
        index + (direction === "up" ? -1 : 1),
      ),
    );
    return this.#commit(
      move(this.state.items, activeId, this.state.items[targetIndex]!.id),
      "keyboard",
    );
  }

  async #commit(
    nextItems: SortableTimelineItem[],
    inputKind: ReorderInputKind,
  ): Promise<void> {
    const previousItems = this.state.items;
    const previousVersion = this.state.dayVersion;
    const orderedIds = nextItems.map(({ id }) => id);
    if (orderedIds.every((id, index) => id === previousItems[index]?.id)) {
      this.state.announcement = "事项已在目标位置";
      return;
    }
    this.state.items = nextItems;
    this.state.saving = true;
    this.state.error = null;
    this.state.announcement = "正在保存新顺序";
    try {
      const saved = await this.#gateway.reorder({
        tripDayId: this.#tripDayId,
        baseVersion: previousVersion,
        orderedIds,
      });
      if (
        saved.tripDayId !== this.#tripDayId
        || saved.version <= previousVersion
        || !sameSet(orderedIds, saved.orderedIds)
      ) {
        throw new Error("服务端返回了无效的排序结果");
      }
      const byId = new Map(nextItems.map((item) => [item.id, item]));
      this.state.items = saved.orderedIds.map((id) => byId.get(id)!);
      this.state.dayVersion = saved.version;
      this.state.announcement =
        `${inputKind === "keyboard" ? "键盘" : inputKind === "touch" ? "触控" : "鼠标"}排序已保存`;
    } catch (error) {
      this.state.items = previousItems;
      this.state.dayVersion = previousVersion;
      this.state.error = errorMessage(error);
      this.state.announcement = "排序保存失败，已恢复原顺序";
      throw error;
    } finally {
      this.state.saving = false;
    }
  }
}

export class SortableTimelineInputAdapter {
  readonly #controller: SortableTimelineController;

  constructor(controller: SortableTimelineController) {
    this.#controller = controller;
  }

  dragEnd(event: DragEndEventLike): Promise<void> {
    if (!event.over) return Promise.resolve();
    const eventLike = event.activatorEvent as {
      type?: string;
      pointerType?: string;
    } | undefined;
    const touch = eventLike?.pointerType === "touch"
      || event.activatorEvent?.type?.startsWith("touch") === true;
    return touch
      ? this.#controller.reorderByTouch(String(event.active.id), String(event.over.id))
      : this.#controller.reorderByMouse(String(event.active.id), String(event.over.id));
  }

  keyboardMove(
    activeId: string,
    direction: "up" | "down",
  ): Promise<void> {
    return this.#controller.reorderByKeyboard(activeId, direction);
  }
}

export function touchActionFor(
  target: "drag-handle" | "timeline-content",
): "none" | "pan-y" {
  return target === "drag-handle" ? "none" : "pan-y";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderSortableTimeline(
  state: SortableTimelineState,
): string {
  const items = state.items.map((item, index) =>
    `<li data-sortable-id="${escapeHtml(item.id)}"><article><button type="button" data-drag-handle="${escapeHtml(item.id)}" aria-label="拖动 ${escapeHtml(item.target)}" style="touch-action:${touchActionFor("drag-handle")}">拖动</button><span>${escapeHtml(item.target)}</span><button type="button" data-keyboard-move="up" data-target="${escapeHtml(item.id)}" aria-label="上移 ${escapeHtml(item.target)}"${index === 0 || state.saving ? " disabled" : ""}>上移</button><button type="button" data-keyboard-move="down" data-target="${escapeHtml(item.id)}" aria-label="下移 ${escapeHtml(item.target)}"${index === state.items.length - 1 || state.saving ? " disabled" : ""}>下移</button></article></li>`
  ).join("");
  return `<section aria-label="可排序行程时间线" style="touch-action:${touchActionFor("timeline-content")}"><ol>${items}</ol><p role="status" aria-live="polite">${escapeHtml(state.announcement)}</p>${state.error ? `<p role="alert">${escapeHtml(state.error)}</p>` : ""}</section>`;
}
import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
