export type SelectionKind = "item" | "marker" | "segment";

export type Selection = {
  readonly kind: SelectionKind;
  readonly id: string;
  readonly itemId?: string;
  readonly dayId?: string;
};

export type FocusCommand =
  | { readonly type: "focus-marker"; readonly id: string; readonly pan: boolean }
  | { readonly type: "focus-timeline"; readonly id: string; readonly preventScroll: boolean }
  | { readonly type: "focus-segment"; readonly id: string }
  | { readonly type: "clear-selection"; readonly reason: "filtered" | "deleted" | "unavailable" };

export type SelectionState = {
  readonly selected: Selection | null;
  readonly focus: FocusCommand | null;
  readonly mapReady: boolean;
  readonly visibleItemIds: ReadonlySet<string>;
  readonly mountedTimelineItemIds: ReadonlySet<string>;
};

export type SelectionListener = (state: SelectionState) => void;

export class MapTimelineSelectionStore {
  private listeners = new Set<SelectionListener>();

  state: SelectionState = {
    selected: null,
    focus: null,
    mapReady: false,
    visibleItemIds: new Set(),
    mountedTimelineItemIds: new Set(),
  };

  subscribe(listener: SelectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setMapReady(mapReady: boolean): void {
    this.state = { ...this.state, mapReady };
    if (!mapReady && this.state.selected?.kind === "marker") this.clear("unavailable");
    else this.emit();
  }

  setVisibleItemIds(ids: Iterable<string>): void {
    const visibleItemIds = new Set(ids);
    this.state = { ...this.state, visibleItemIds };
    const selected = this.state.selected;
    if (selected?.itemId && !visibleItemIds.has(selected.itemId)) this.clear("filtered");
    else this.emit();
  }

  setMountedTimelineItemIds(ids: Iterable<string>): void {
    this.state = { ...this.state, mountedTimelineItemIds: new Set(ids) };
    this.emit();
  }

  selectFromTimeline(itemId: string, dayId?: string): void {
    this.state = {
      ...this.state,
      selected: { kind: "item", id: itemId, itemId, ...(dayId ? { dayId } : {}) },
      focus: { type: "focus-marker", id: itemId, pan: this.state.mapReady },
    };
    this.emit();
  }

  selectFromMarker(itemId: string, dayId?: string): void {
    this.state = {
      ...this.state,
      selected: { kind: "marker", id: itemId, itemId, ...(dayId ? { dayId } : {}) },
      focus: {
        type: "focus-timeline",
        id: itemId,
        preventScroll: this.state.mountedTimelineItemIds.has(itemId),
      },
    };
    this.emit();
  }

  selectSegment(segmentId: string): void {
    this.state = {
      ...this.state,
      selected: { kind: "segment", id: segmentId },
      focus: { type: "focus-segment", id: segmentId },
    };
    this.emit();
  }

  restore(selection: Selection | null): void {
    if (!selection) return this.clear("unavailable");
    this.state = { ...this.state, selected: selection, focus: null };
    this.emit();
  }

  clear(reason: "filtered" | "deleted" | "unavailable"): void {
    this.state = { ...this.state, selected: null, focus: { type: "clear-selection", reason } };
    this.emit();
  }

  consumeFocus(): FocusCommand | null {
    const focus = this.state.focus;
    if (!focus) return null;
    this.state = { ...this.state, focus: null };
    this.emit();
    return focus;
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}
