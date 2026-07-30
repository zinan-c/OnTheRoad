import {
  ItemEditor,
  ItemEditorValidationError,
  type EditorDraft,
  type EditorPayload,
  type ItemKind,
  workspaceLayout,
} from "./item-editor.js";

export type TripDay = {
  id: string;
  dayNumber: number;
  date: string;
  destination?: string;
  totalCost?: string;
  unresolvedCount?: number;
};

export type TimelineItem = {
  id: string;
  version: number;
  tripDayId: string;
  kind: ItemKind;
  target: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  locationText?: string;
  costLabel?: string;
  notes?: string;
  editorDraft?: Partial<EditorDraft>;
};

type GatewayError = Error & {
  status?: number;
  fieldErrors?: Record<string, string>;
};

export type ItineraryGateway = {
  listDays: (tripId: string) => Promise<TripDay[]>;
  loadItems: (tripId: string, dayId: string) => Promise<TimelineItem[]>;
  saveItem?: (
    payload: EditorPayload,
    context: { itemId?: string; version?: number },
  ) => Promise<TimelineItem>;
  deleteItem?: (itemId: string, version: number) => Promise<void>;
  copyItem?: (itemId: string, targetDayId: string) => Promise<TimelineItem>;
};

export type MobileSection = "itinerary" | "map" | "day";

export type WorkspaceState = {
  tripId: string | null;
  days: TripDay[];
  selectedDayId: string | null;
  items: TimelineItem[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  conflict: boolean;
  fieldErrors: Record<string, string>;
  editor: ItemEditor | null;
  mobileSection: MobileSection;
};

export class ItineraryWorkspace {
  readonly state: WorkspaceState = {
    tripId: null,
    days: [],
    selectedDayId: null,
    items: [],
    loading: false,
    saving: false,
    error: null,
    conflict: false,
    fieldErrors: {},
    editor: null,
    mobileSection: "itinerary",
  };

  readonly #gateway: ItineraryGateway;

  constructor(gateway: ItineraryGateway) {
    this.#gateway = gateway;
  }

  get editor(): ItemEditor | null {
    return this.state.editor;
  }

  async load(tripId: string): Promise<void> {
    this.state.tripId = tripId;
    this.state.loading = true;
    this.state.error = null;
    try {
      this.state.days = await this.#gateway.listDays(tripId);
      const selectedStillExists = this.state.days.some(
        ({ id }) => id === this.state.selectedDayId,
      );
      this.state.selectedDayId = selectedStillExists
        ? this.state.selectedDayId
        : this.state.days[0]?.id ?? null;
      this.state.items = this.state.selectedDayId
        ? await this.#gateway.loadItems(tripId, this.state.selectedDayId)
        : [];
    } catch (error) {
      this.state.error = messageOf(error, "无法载入行程");
      throw error;
    } finally {
      this.state.loading = false;
    }
  }

  async selectDay(dayId: string): Promise<void> {
    if (!this.state.tripId) throw new Error("Workspace is not loaded");
    if (!this.state.days.some(({ id }) => id === dayId)) {
      throw new RangeError("Day does not belong to the loaded trip");
    }
    this.state.selectedDayId = dayId;
    this.state.loading = true;
    this.state.error = null;
    this.state.editor = null;
    try {
      this.state.items = await this.#gateway.loadItems(this.state.tripId, dayId);
    } catch (error) {
      this.state.error = messageOf(error, "无法载入当天行程");
      throw error;
    } finally {
      this.state.loading = false;
    }
  }

  beginCreate(kind: ItemKind): ItemEditor {
    const tripId = this.state.tripId;
    const dayId = this.state.selectedDayId;
    if (!tripId || !dayId) throw new Error("Select a Day before adding an item");
    this.state.fieldErrors = {};
    this.state.conflict = false;
    this.state.editor = new ItemEditor({ tripId, dayId, kind });
    return this.state.editor;
  }

  beginEdit(itemId: string): ItemEditor {
    const tripId = this.state.tripId;
    const item = this.state.items.find(({ id }) => id === itemId);
    if (!tripId || !item) throw new Error("Timeline item is unavailable");
    this.state.fieldErrors = {};
    this.state.conflict = false;
    this.state.editor = new ItemEditor({
      tripId,
      dayId: item.tripDayId,
      kind: item.kind,
      itemId: item.id,
      version: item.version,
      initial: {
        target: item.target,
        description: item.description ?? "",
        startTime: item.startTime ?? "",
        endTime: item.endTime ?? "",
        locationText: item.locationText ?? "",
        notes: item.notes ?? "",
        ...item.editorDraft,
      },
    });
    return this.state.editor;
  }

  closeEditor(): void {
    this.state.editor = null;
    this.state.fieldErrors = {};
    this.state.conflict = false;
  }

  async save(): Promise<TimelineItem> {
    const editor = this.state.editor;
    if (!editor) throw new Error("No item is being edited");
    if (!this.#gateway.saveItem) throw new Error("saveItem is unavailable");
    this.state.saving = true;
    this.state.error = null;
    this.state.fieldErrors = {};
    this.state.conflict = false;
    try {
      const saved = await this.#gateway.saveItem(editor.payload(), {
        ...(editor.itemId ? { itemId: editor.itemId } : {}),
        ...(editor.version === undefined ? {} : { version: editor.version }),
      });
      const index = this.state.items.findIndex(({ id }) => id === saved.id);
      if (index === -1) this.state.items.push(saved);
      else this.state.items[index] = saved;
      this.closeEditor();
      return saved;
    } catch (error) {
      if (error instanceof ItemEditorValidationError) {
        this.state.fieldErrors = { ...error.fieldErrors };
      } else {
        const gatewayError = error as GatewayError;
        this.state.fieldErrors = { ...gatewayError.fieldErrors };
        this.state.conflict = gatewayError.status === 409;
        this.state.error = messageOf(error, "保存失败");
      }
      throw error;
    } finally {
      this.state.saving = false;
    }
  }

  keepConflictDraft(): void {
    this.state.conflict = false;
    this.state.error = null;
  }

  async reloadAfterConflict(): Promise<void> {
    const dayId = this.state.selectedDayId;
    if (!dayId) return;
    await this.selectDay(dayId);
  }

  async retryLoad(): Promise<void> {
    if (!this.state.tripId) throw new Error("Workspace is not loaded");
    await this.load(this.state.tripId);
  }

  async delete(itemId: string): Promise<void> {
    const item = this.state.items.find(({ id }) => id === itemId);
    if (!item || !this.#gateway.deleteItem) {
      throw new Error("deleteItem is unavailable");
    }
    await this.#gateway.deleteItem(item.id, item.version);
    this.state.items = this.state.items.filter(({ id }) => id !== item.id);
    if (this.state.editor?.itemId === item.id) this.closeEditor();
  }

  async copy(itemId: string, targetDayId: string): Promise<TimelineItem> {
    if (!this.#gateway.copyItem) throw new Error("copyItem is unavailable");
    const copied = await this.#gateway.copyItem(itemId, targetDayId);
    if (targetDayId === this.state.selectedDayId) this.state.items.push(copied);
    return copied;
  }

  setMobileSection(section: MobileSection): void {
    this.state.mobileSection = section;
  }

  async dispatch(
    action:
      | "retry-load"
      | "reload-conflict"
      | "keep-draft"
      | "save"
      | "cancel"
      | "create-activity"
      | "create-attraction"
      | "create-dining"
      | "create-accommodation"
      | "create-transport"
      | "edit"
      | "copy"
      | "delete"
      | "select-day"
      | "mobile-itinerary"
      | "mobile-map"
      | "mobile-day",
    target?: string,
  ): Promise<unknown> {
    if (action === "retry-load") return this.retryLoad();
    if (action === "reload-conflict") return this.reloadAfterConflict();
    if (action === "keep-draft") return this.keepConflictDraft();
    if (action === "save") return this.save();
    if (action === "cancel") return this.closeEditor();
    if (action.startsWith("create-")) {
      return this.beginCreate(action.slice(7) as ItemKind);
    }
    if (action === "edit" && target) return this.beginEdit(target);
    if (action === "copy" && target && this.state.selectedDayId) {
      return this.copy(target, this.state.selectedDayId);
    }
    if (action === "delete" && target) return this.delete(target);
    if (action === "select-day" && target) return this.selectDay(target);
    if (action.startsWith("mobile-")) {
      return this.setMobileSection(action.slice(7) as MobileSection);
    }
    throw new Error(`Action ${action} requires a valid target`);
  }

  keyboardOrder(): string[] {
    return [
      ...this.state.days.map(({ id }) => `day-${id}`),
      ...this.state.items.map(({ id }) => `item-${id}`),
      "add-item",
      "mobile-itinerary",
      "mobile-map",
      "mobile-day",
      ...(this.state.editor
        ? [
          "editor-target",
          "editor-start-time",
          "editor-location",
          "editor-notes",
          "editor-save",
          "editor-cancel",
        ]
        : []),
    ];
  }

  async handleKey(key: string, currentId: string): Promise<string> {
    if (key === "Escape" && this.state.editor) {
      this.closeEditor();
      return "add-item";
    }
    const order = this.keyboardOrder();
    const currentIndex = order.indexOf(currentId);
    if (currentIndex === -1) return currentId;
    if (key === "ArrowDown" || key === "ArrowRight") {
      const next = order[Math.min(order.length - 1, currentIndex + 1)]!;
      if (next.startsWith("day-")) await this.selectDay(next.slice(4));
      return next;
    }
    if (key === "ArrowUp" || key === "ArrowLeft") {
      const previous = order[Math.max(0, currentIndex - 1)]!;
      if (previous.startsWith("day-")) await this.selectDay(previous.slice(4));
      return previous;
    }
    return currentId;
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function field(
  state: WorkspaceState,
  name: keyof EditorDraft,
  label: string,
  type = "text",
): string {
  const value = state.editor?.draft[name];
  const displayed = typeof value === "boolean" ? String(value) : String(value ?? "");
  const error = state.fieldErrors[name];
  const errorId = `${name}-error`;
  return `<label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${escapeHtml(displayed)}"${error ? ` aria-invalid="true" aria-describedby="${errorId}"` : ""}>${error ? `<p id="${errorId}" role="alert">${escapeHtml(error)}</p>` : ""}`;
}

function renderEditor(state: WorkspaceState): string {
  if (!state.editor) return "";
  return `<form aria-label="行程事项编辑器">
  <fieldset><legend>时间与事项</legend>${field(state, "target", "事项名称")}${field(state, "description", "描述")}${field(state, "startTime", "开始时间", "time")}${field(state, "endTime", "结束时间", "time")}${field(state, "durationMinutes", "时长（分钟）", "number")}</fieldset>
  <fieldset><legend>地点</legend>${field(state, "locationText", "地点")}</fieldset>
  <fieldset><legend>交通</legend>${field(state, "transportModeId", "如何从上一站到这里")}${field(state, "transportOrigin", "起点")}${field(state, "transportDestination", "终点")}</fieldset>
  <fieldset><legend>食宿与预订</legend>${field(state, "diningName", "餐厅")}${field(state, "mealType", "用餐类型")}${field(state, "hotelName", "住宿")}${field(state, "accommodationType", "住宿类型")}${field(state, "checkInDate", "入住日期", "date")}${field(state, "checkOutDate", "退房日期", "date")}${field(state, "reservationReference", "预订编号")}${field(state, "contactName", "联系人")}${field(state, "contactPhone", "联系电话", "tel")}</fieldset>
  <fieldset><legend>费用</legend>${field(state, "costAmount", "金额", "decimal")}${field(state, "costCurrency", "币种")}${field(state, "costCategory", "费用类别")}</fieldset>
  <fieldset><legend>备注</legend><label for="notes">备注</label><textarea id="notes" name="notes"${state.fieldErrors.notes ? ' aria-invalid="true" aria-describedby="notes-error"' : ""}>${escapeHtml(state.editor.draft.notes)}</textarea>${state.fieldErrors.notes ? `<p id="notes-error" role="alert">${escapeHtml(state.fieldErrors.notes)}</p>` : ""}</fieldset>
  ${state.conflict ? '<div role="alert">该事项已被其他会话修改。草稿仍保留。<button type="button" data-action="reload-conflict">重新载入</button><button type="button" data-action="keep-draft">保留草稿</button></div>' : ""}
  <button id="editor-save" type="submit" data-action="save"${state.saving ? " disabled" : ""}>${state.saving ? "保存中" : "保存"}</button><button id="editor-cancel" type="button" data-action="cancel">取消</button>
  </form>`;
}

export function renderWorkspace(
  state: WorkspaceState,
  viewportWidth: number,
): string {
  const layout = workspaceLayout(viewportWidth);
  const selectedDay = state.days.find(({ id }) => id === state.selectedDayId);
  const dayList = state.days.map((day) =>
    `<li><button id="day-${escapeHtml(day.id)}" data-action="select-day" data-target="${escapeHtml(day.id)}" aria-current="${day.id === state.selectedDayId ? "date" : "false"}">Day ${day.dayNumber} ${escapeHtml(day.date)} ${escapeHtml(day.destination ?? "")}</button></li>`
  ).join("");
  const cards = state.items.map((item) =>
    `<article id="item-${escapeHtml(item.id)}" tabindex="0"><time>${escapeHtml(item.startTime ?? "未定时间")}</time><h3>${escapeHtml(item.target)}</h3><p>${escapeHtml(item.locationText ?? "地点待确认")}</p>${item.costLabel ? `<p>${escapeHtml(item.costLabel)}</p>` : ""}<button data-action="edit" data-target="${escapeHtml(item.id)}" aria-label="编辑 ${escapeHtml(item.target)}">编辑</button><button data-action="copy" data-target="${escapeHtml(item.id)}" aria-label="复制 ${escapeHtml(item.target)}">复制</button><button data-action="delete" data-target="${escapeHtml(item.id)}" aria-label="删除 ${escapeHtml(item.target)}">删除</button></article>`
  ).join("");
  const addControls = `<div aria-label="新增事项类型"><button id="add-item" data-action="create-activity" aria-label="新增行程事项">活动</button><button data-action="create-attraction">景点</button><button data-action="create-dining">餐饮</button><button data-action="create-accommodation">住宿</button><button data-action="create-transport">交通</button></div>`;
  const status = state.loading
    ? '<div role="status" aria-live="polite">正在加载当天行程…</div>'
    : state.error && !state.conflict
      ? `<div role="alert">${escapeHtml(state.error)}<button type="button" data-action="retry-load">重试</button></div>`
      : state.items.length === 0
        ? `<section aria-label="空行程"><p>这一天还没有行程</p>${addControls}</section>`
        : `<section aria-label="当天时间线">${cards}${addControls}</section>`;
  const mobileTabs = `<nav aria-label="移动工作台"><button id="mobile-itinerary" data-action="mobile-itinerary" aria-pressed="${state.mobileSection === "itinerary"}">行程</button><button id="mobile-map" data-action="mobile-map" aria-pressed="${state.mobileSection === "map"}">地图</button><button id="mobile-day" data-action="mobile-day" aria-pressed="${state.mobileSection === "day"}">日详情</button></nav>`;
  return `<main data-layout="${layout}">
  ${layout === "mobile" ? mobileTabs : ""}
  <aside aria-label="Day 列表"${layout === "mobile" && state.mobileSection !== "day" ? " hidden" : ""}><ol>${dayList}</ol></aside>
  <section aria-label="行程编辑区"${layout === "mobile" && state.mobileSection !== "itinerary" ? " hidden" : ""}><header><h1>${selectedDay ? `Day ${selectedDay.dayNumber}` : "选择一天"}</h1></header>${status}${renderEditor(state)}</section>
  <section aria-label="地图区域" data-map-slot="itinerary"${layout === "mobile" && state.mobileSection !== "map" ? " hidden" : ""}><p>地图由地图模块接入</p></section>
  </main>`;
}
