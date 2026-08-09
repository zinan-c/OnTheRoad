"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

export type ProductReorderInput = "mouse" | "touch" | "keyboard";

type TimelineEntry = { id: string; label: string };

function SortableRow({
  entry,
  index,
  total,
  disabled,
  children,
  onKeyboardMove,
}: {
  readonly entry: TimelineEntry;
  readonly index: number;
  readonly total: number;
  readonly disabled: boolean;
  readonly children: ReactNode;
  readonly onKeyboardMove: (id: string, direction: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
    disabled,
  });
  return <li
    ref={setNodeRef}
    className="productTimelineItem"
    data-dragging={isDragging || undefined}
    style={{ transform: CSS.Transform.toString(transform), transition }}
  >
    <button
      type="button"
      className="dragHandle"
      aria-label={`拖动 ${entry.label}`}
      disabled={disabled}
      {...attributes}
      {...listeners}
    >⠿</button>
    <div className="timelineItemContent">{children}</div>
    <div className="keyboardOrderActions" aria-label={`${entry.label} 排序操作`}>
      <button type="button" aria-label={`上移 ${entry.label}`} disabled={disabled || index === 0} onClick={() => onKeyboardMove(entry.id, -1)}>↑</button>
      <button type="button" aria-label={`下移 ${entry.label}`} disabled={disabled || index === total - 1} onClick={() => onKeyboardMove(entry.id, 1)}>↓</button>
    </div>
  </li>;
}

export function ProductSortableTimeline({
  entries,
  disabled = false,
  label,
  children,
  onReorder,
}: {
  readonly entries: readonly TimelineEntry[];
  readonly disabled?: boolean;
  readonly label: string;
  readonly children: (id: string) => ReactNode;
  readonly onReorder: (orderedIds: string[], input: ProductReorderInput) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function move(activeId: string, overId: string, input: ProductReorderInput) {
    const from = entries.findIndex(({ id }) => id === activeId);
    const to = entries.findIndex(({ id }) => id === overId);
    if (from < 0 || to < 0 || from === to) return;
    onReorder(arrayMove([...entries], from, to).map(({ id }) => id), input);
  }

  function dragEnd(event: DragEndEvent) {
    if (!event.over) return;
    const activator = event.activatorEvent as Event & { pointerType?: string };
    const input = activator.pointerType === "touch" || activator.type.startsWith("touch")
      ? "touch"
      : activator.type.startsWith("key") ? "keyboard" : "mouse";
    move(String(event.active.id), String(event.over.id), input);
  }

  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
    <SortableContext items={entries.map(({ id }) => id)} strategy={verticalListSortingStrategy}>
      <ol className="productTimeline" aria-label={label}>
        {entries.map((entry, index) => <SortableRow
          key={entry.id}
          entry={entry}
          index={index}
          total={entries.length}
          disabled={disabled}
          onKeyboardMove={(id, direction) => {
            const target = entries[index + direction];
            if (target) move(id, target.id, "keyboard");
          }}
        >{children(entry.id)}</SortableRow>)}
      </ol>
    </SortableContext>
  </DndContext>;
}
