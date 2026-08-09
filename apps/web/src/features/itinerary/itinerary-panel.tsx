"use client";

import { transportModes } from "@on-the-road/config/reference-data";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EditorDraft, ItemKind } from "./item-editor";
import {
  ProductSortableTimeline,
  type ProductReorderInput,
} from "./product-sortable-timeline";
import { TransportModeManager } from "../trips/settings/transport-mode-manager";
import type { TransportModeView } from "../trips/settings/transport-modes";
import { LocationProductPicker } from "../locations/location-product-picker";

export type ProductDay = {
  id: string;
  dayNumber: number;
  date?: string;
  version?: number;
};

export type ProductItem = {
  id: string;
  tripDayId: string;
  itemType: "activity" | "attraction" | "dining" | "hotel" | "transport" | "other";
  target: string | null;
  description: string | null;
  timeKind: "clock" | "range" | "period" | "unscheduled";
  startTime: string | null;
  endTime: string | null;
  endDayOffset: number;
  timePeriod: string | null;
  durationMinutes: number | null;
  locationId: string | null;
  startLocationId: string | null;
  endLocationId: string | null;
  transportModeCode: string | null;
  bookingInfo: unknown;
  contactInfo: unknown;
  remark: string | null;
  dining: { name: string; mealType?: string | null } | null;
  accommodation: {
    name: string;
    details?: string | null;
    checkInAt?: string | null;
    checkOutAt?: string | null;
    bookingInfo?: unknown;
    contactInfo?: unknown;
  } | null;
  version: number;
};

type ItemDraft = EditorDraft & { kind: ItemKind };

type ProductExpense = {
  id: string;
  itineraryItemId: string | null;
  originalAmount: string;
  currency: string;
  categoryCode: string;
  version: number;
};

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";

export async function itineraryApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ORIGIN}/api/v1${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { accept: "application/json, application/problem+json", ...init?.headers },
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null) as { title?: string; detail?: string } | null;
    throw Object.assign(new Error(problem?.detail ?? problem?.title ?? `请求失败：${response.status}`), {
      status: response.status,
    });
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}

function emptyDraft(kind: ItemKind = "activity"): ItemDraft {
  return {
    kind,
    target: "",
    description: "",
    timeKind: "unscheduled",
    timePeriod: "",
    startTime: "",
    endTime: "",
    crossesMidnight: false,
    locationText: "",
    locationId: "",
    transportModeId: "",
    transportOrigin: "",
    transportDestination: "",
    diningName: "",
    mealType: "",
    hotelName: "",
    accommodationType: "",
    checkInDate: "",
    checkOutDate: "",
    reservationReference: "",
    contactName: "",
    contactPhone: "",
    costAmount: "",
    costCurrency: "CNY",
    costCategory: "OTHER",
    notes: "",
  };
}

function datePart(value: string | null | undefined): string {
  return value?.slice(0, 10) ?? "";
}

function displayAmount(value: string): string {
  return value.includes(".") ? value.replace(/0+$/u, "").replace(/\.$/u, "") : value;
}

function itemDraft(item: ProductItem): ItemDraft {
  const booking = item.bookingInfo && typeof item.bookingInfo === "object"
    ? JSON.stringify(item.bookingInfo)
    : String(item.bookingInfo ?? item.accommodation?.bookingInfo ?? "");
  const contact = item.contactInfo && typeof item.contactInfo === "object"
    ? item.contactInfo as { name?: string; phone?: string }
    : {};
  return {
    ...emptyDraft(item.itemType === "hotel" ? "accommodation" : item.itemType),
    target: item.target ?? "",
    description: item.description ?? "",
    timeKind: item.timeKind,
    timePeriod: item.timePeriod ?? "",
    startTime: item.startTime ?? "",
    endTime: item.endTime ?? "",
    crossesMidnight: item.endDayOffset === 1,
    ...(item.durationMinutes === null ? {} : { durationMinutes: item.durationMinutes }),
    locationId: item.locationId ?? "",
    transportModeId: item.transportModeCode ?? "",
    transportOrigin: item.startLocationId ?? "",
    transportDestination: item.endLocationId ?? "",
    diningName: item.dining?.name ?? "",
    mealType: item.dining?.mealType ?? "",
    hotelName: item.accommodation?.name ?? "",
    accommodationType: item.accommodation?.details ?? "",
    checkInDate: datePart(item.accommodation?.checkInAt),
    checkOutDate: datePart(item.accommodation?.checkOutAt),
    reservationReference: booking,
    contactName: contact.name ?? "",
    contactPhone: contact.phone ?? "",
    notes: item.remark ?? "",
  };
}

function itemPayload(draft: ItemDraft) {
  const payload: Record<string, unknown> = {
    itemType: draft.kind === "accommodation" ? "hotel" : draft.kind,
    timeKind: draft.timeKind,
    target: draft.target.trim(),
    description: draft.description.trim() || null,
    startTime: draft.startTime || null,
    endTime: draft.endTime || null,
    endDayOffset: draft.crossesMidnight ? 1 : 0,
    timePeriod: draft.timePeriod || null,
    durationMinutes: draft.durationMinutes ?? null,
    locationId: draft.locationId || null,
    startLocationId: draft.transportOrigin || null,
    endLocationId: draft.transportDestination || null,
    transportModeCode: draft.transportModeId || null,
    bookingInfo: draft.reservationReference || null,
    contactInfo: draft.contactName || draft.contactPhone
      ? { name: draft.contactName, phone: draft.contactPhone }
      : null,
    remark: draft.notes.trim() || null,
  };
  if (draft.kind === "dining") {
    payload.dining = { name: draft.diningName.trim(), mealType: draft.mealType || null };
  }
  if (draft.kind === "accommodation") {
    payload.accommodation = {
      name: draft.hotelName.trim(),
      details: draft.accommodationType.trim() || null,
      checkInDate: draft.checkInDate || null,
      checkOutDate: draft.checkOutDate || null,
      bookingInfo: draft.reservationReference || null,
      contactInfo: draft.contactName || draft.contactPhone
        ? { name: draft.contactName, phone: draft.contactPhone }
        : null,
    };
  }
  return payload;
}

function draftFingerprint(draft: ItemDraft) {
  return JSON.stringify({
    item: itemPayload(draft),
    expense: {
      amount: draft.costAmount,
      currency: draft.costCurrency,
      categoryCode: draft.costCategory,
    },
  });
}

export function ItineraryPanel({
  tripId,
  onTransportModesChange,
  onItemsChange,
  onRoutesInvalidated,
}: {
  readonly tripId: string;
  readonly onTransportModesChange?: (modes: TransportModeView[]) => void;
  readonly onItemsChange?: (dayId: string, items: ProductItem[]) => void;
  readonly onRoutesInvalidated?: () => void;
}) {
  const [days, setDays] = useState<ProductDay[]>([]);
  const [selectedDayId, setSelectedDayId] = useState("");
  const [items, setItems] = useState<ProductItem[]>([]);
  const [draft, setDraft] = useState<ItemDraft>(() => emptyDraft());
  const [editing, setEditing] = useState<ProductItem | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "dirty" | "saving" | "saved" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [modeManagerOpen, setModeManagerOpen] = useState(false);
  const [expenseLoading, setExpenseLoading] = useState(false);
  const [modeCatalog, setModeCatalog] = useState<TransportModeView[]>(() => transportModes.map((mode) => ({
    ...mode,
    id: `system:${mode.code}`,
    tripId: null,
    ownerId: null,
    isSystem: true,
    enabled: true,
    referenced: false,
    version: 1,
  })));
  const confirmedPayload = useRef("");
  const saveSequence = useRef(0);
  const expenseRef = useRef<ProductExpense | null>(null);

  const loadItems = useCallback(async (dayId: string) => {
    setStatus("loading");
    try {
      const loaded = await itineraryApi<ProductItem[]>(`/trips/${tripId}/days/${dayId}/itinerary-items`);
      setItems(loaded);
      onItemsChange?.(dayId, loaded);
      setError(null);
      setStatus("idle");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法载入当天行程");
      setStatus("error");
    }
  }, [onItemsChange, tripId]);

  useEffect(() => {
    void itineraryApi<ProductDay[]>(`/trips/${tripId}/days`).then((loaded) => {
      setDays(loaded);
      const first = loaded[0]?.id ?? "";
      setSelectedDayId(first);
      if (first) void loadItems(first);
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "无法载入 Day");
      setStatus("error");
    });
  }, [loadItems, tripId]);

  const selectedDay = useMemo(
    () => days.find(({ id }) => id === selectedDayId),
    [days, selectedDayId],
  );

  const loadTransportModes = useCallback(async () => {
    try {
      const loaded = await itineraryApi<TransportModeView[]>(`/trips/${tripId}/transport-modes`);
      setModeCatalog(loaded);
      onTransportModesChange?.(loaded);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法载入交通方式");
    }
  }, [onTransportModesChange, tripId]);

  function update<K extends keyof ItemDraft>(field: K, value: ItemDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    if (editing) setStatus("dirty");
  }

  function beginCreate(kind: ItemKind) {
    setEditing(null);
    setDraft(emptyDraft(kind));
    setEditorOpen(true);
    setError(null);
    setStatus("idle");
    setExpenseLoading(false);
    expenseRef.current = null;
    if (kind === "transport") void loadTransportModes();
  }

  function beginEdit(item: ProductItem) {
    const nextDraft = itemDraft(item);
    setEditing(item);
    setDraft(nextDraft);
    confirmedPayload.current = draftFingerprint(nextDraft);
    setEditorOpen(true);
    setError(null);
    setStatus("idle");
    setExpenseLoading(true);
    expenseRef.current = null;
    void itineraryApi<ProductExpense[]>(`/trips/${tripId}/itinerary-items/${item.id}/expenses`).then((loaded) => {
      const primary = loaded.find((candidate) => candidate.itineraryItemId === item.id
        && typeof candidate.originalAmount === "string") ?? null;
      expenseRef.current = primary;
      const withExpense = primary ? {
        ...nextDraft,
        costAmount: displayAmount(primary.originalAmount),
        costCurrency: primary.currency,
        costCategory: primary.categoryCode,
      } : nextDraft;
      confirmedPayload.current = draftFingerprint(withExpense);
      setDraft((current) => ({
        ...current,
        costAmount: withExpense.costAmount,
        costCurrency: withExpense.costCurrency,
        costCategory: withExpense.costCategory,
      }));
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "无法载入事项费用");
    }).finally(() => setExpenseLoading(false));
    if (item.itemType === "transport") void loadTransportModes();
  }

  const persistEdit = useCallback(async (
    item: ProductItem,
    snapshot: ItemDraft,
    sequence: number,
  ) => {
    setStatus("saving");
    setError(null);
    onRoutesInvalidated?.();
    try {
      const saved = await itineraryApi<ProductItem>(`/trips/${tripId}/itinerary-items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "if-match": String(item.version) },
        body: JSON.stringify(itemPayload(snapshot)),
      });
      if (snapshot.costAmount) {
        const currentExpense = expenseRef.current;
        expenseRef.current = currentExpense
          ? await itineraryApi<ProductExpense>(`/trips/${tripId}/expenses/${currentExpense.id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json", "if-match": String(currentExpense.version) },
              body: JSON.stringify({ amount: snapshot.costAmount, currency: snapshot.costCurrency, categoryCode: snapshot.costCategory }),
            })
          : await itineraryApi<ProductExpense>(`/trips/${tripId}/expenses`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ itineraryItemId: item.id, amount: snapshot.costAmount, currency: snapshot.costCurrency, categoryCode: snapshot.costCategory }),
            });
      }
      if (sequence !== saveSequence.current) return;
      confirmedPayload.current = draftFingerprint(snapshot);
      setEditing(saved);
      setItems((current) => current.map((entry) => entry.id === saved.id ? saved : entry));
      setStatus("saved");
    } catch (caught) {
      if (sequence !== saveSequence.current) return;
      setError(caught instanceof Error ? caught.message : "保存失败");
      setStatus("error");
    }
  }, [onRoutesInvalidated, tripId]);

  useEffect(() => {
    if (!editorOpen || !editing || expenseLoading) return;
    const serialized = draftFingerprint(draft);
    if (serialized === confirmedPayload.current) {
      setStatus((current) => current === "dirty" ? "saved" : current);
      return;
    }
    setStatus("dirty");
    const sequence = ++saveSequence.current;
    const timer = window.setTimeout(() => {
      void persistEdit(editing, structuredClone(draft), sequence);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draft, editing, editorOpen, expenseLoading, persistEdit]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!["dirty", "saving", "error"].includes(status)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);

  async function save() {
    if (!selectedDayId || (!draft.target.trim() && !draft.description.trim())) {
      setError("事项名称或描述至少填写一项");
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      if (editing) {
        const sequence = ++saveSequence.current;
        await persistEdit(editing, structuredClone(draft), sequence);
        return;
      }
      onRoutesInvalidated?.();
      const saved = await itineraryApi<ProductItem>(`/trips/${tripId}/days/${selectedDayId}/itinerary-items`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(itemPayload(draft)),
          });
      if (draft.costAmount) {
        await itineraryApi(`/trips/${tripId}/expenses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            itineraryItemId: saved.id,
            amount: draft.costAmount,
            currency: draft.costCurrency,
            categoryCode: draft.costCategory,
          }),
        });
      }
      await loadItems(selectedDayId);
      setEditing(saved);
      confirmedPayload.current = draftFingerprint(draft);
      setStatus("saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
      setStatus("error");
    }
  }

  async function copyItem(item: ProductItem, targetDayId: string) {
    if (!targetDayId) return;
    setStatus("saving");
    setError(null);
    try {
      await itineraryApi<ProductItem>(`/trips/${tripId}/itinerary-items/${item.id}/copy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetTripDayId: targetDayId }),
      });
      if (targetDayId === selectedDayId) await loadItems(selectedDayId);
      setStatus("saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "复制失败");
      setStatus("error");
    }
  }

  async function deleteItem(item: ProductItem) {
    if (!window.confirm(`确定删除“${item.target || item.description}”吗？`)) return;
    setStatus("saving");
    setError(null);
    try {
      await itineraryApi(`/trips/${tripId}/itinerary-items/${item.id}`, {
        method: "DELETE",
        headers: { "if-match": String(item.version) },
      });
      setItems((current) => current.filter(({ id }) => id !== item.id));
      if (editing?.id === item.id) {
        setEditorOpen(false);
        setEditing(null);
      }
      setStatus("saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除失败");
      setStatus("error");
    }
  }

  async function reorderItems(orderedIds: string[], input: ProductReorderInput) {
    if (!selectedDay || selectedDay.version === undefined) {
      setError("当前 Day 缺少版本信息，无法安全排序");
      return;
    }
    const previous = items;
    const byId = new Map(items.map((item) => [item.id, item]));
    setItems(orderedIds.map((id) => byId.get(id)!).filter(Boolean));
    setStatus("saving");
    setError(null);
    onRoutesInvalidated?.();
    try {
      const saved = await itineraryApi<{ tripDayId: string; version: number; orderedIds: string[] }>(
        `/trips/${tripId}/days/${selectedDay.id}/itinerary-items/reorder`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ baseVersion: selectedDay.version, orderedIds }),
        },
      );
      const savedById = new Map(previous.map((item) => [item.id, item]));
      setItems(saved.orderedIds.map((id) => savedById.get(id)!).filter(Boolean));
      setDays((current) => current.map((day) => day.id === saved.tripDayId
        ? { ...day, version: saved.version }
        : day));
      setStatus("saved");
    } catch (caught) {
      setItems(previous);
      setError(caught instanceof Error ? `${input} 排序失败：${caught.message}` : "排序失败，已恢复原顺序");
      setStatus("error");
    }
  }

  return <section className="workspaceCard itineraryProduct" aria-label="行程编辑工作台">
    <header>
      <h2>每日行程</h2>
      <p>从页面创建并编辑完整 Item，保存结果会写入真实 API。</p>
    </header>
    <nav className="dayTabs" aria-label="选择 Day">
      {days.map((day) => <button key={day.id} type="button" aria-pressed={day.id === selectedDayId} onClick={() => {
        setSelectedDayId(day.id);
        setEditorOpen(false);
        void loadItems(day.id);
      }}>Day {day.dayNumber}</button>)}
    </nav>
    <div className="itemCreateActions" aria-label="新增事项类型">
      {(["activity", "attraction", "dining", "accommodation", "transport", "other"] as const).map((kind) =>
        <button key={kind} type="button" onClick={() => beginCreate(kind)}>新增 {kind}</button>)}
    </div>
    <button type="button" aria-expanded={modeManagerOpen} onClick={() => setModeManagerOpen((open) => !open)}>交通方式设置</button>
    {modeManagerOpen ? <TransportModeManager tripId={tripId} onCatalogChange={(modes) => {
      setModeCatalog(modes);
      onTransportModesChange?.(modes);
    }} /> : null}
    {error ? <p role="alert" className="formError">{error}</p> : null}
    {status === "loading" ? <p role="status">正在载入行程…</p> : null}
    <ProductSortableTimeline
      entries={items.map((item) => ({ id: item.id, label: item.target || item.description || "未命名事项" }))}
      disabled={status === "saving"}
      label={`Day ${selectedDay?.dayNumber ?? ""} 时间线`}
      onReorder={(orderedIds, input) => void reorderItems(orderedIds, input)}
    >{(id) => {
      const item = items.find((entry) => entry.id === id)!;
      return <>
        <button className="timelineEditButton" type="button" aria-label={`编辑 ${item.target || item.description}`} onClick={() => beginEdit(item)}>
          <strong>{item.target || item.description}</strong><span>{item.itemType} · {item.timeKind === "period" ? item.timePeriod : item.startTime || "未排期"}</span>
        </button>
        <label>复制到<select aria-label={`复制 ${item.target || item.description} 到`} defaultValue="" onChange={(event) => {
          const target = event.target.value;
          event.target.value = "";
          void copyItem(item, target);
        }}><option value="">选择 Day</option>{days.map((day) => <option key={day.id} value={day.id}>Day {day.dayNumber}</option>)}</select></label>
        <button type="button" aria-label={`删除 ${item.target || item.description}`} onClick={() => void deleteItem(item)}>删除</button>
      </>;
    }}</ProductSortableTimeline>
    {!editorOpen && status !== "idle" && status !== "loading" ? <p role="status">
      {status === "saving" ? "正在保存排序…" : status === "saved" ? "已保存" : status === "error" ? "排序保存失败" : ""}
    </p> : null}
    {editorOpen ? <form className="itemEditorForm" aria-label={editing ? "编辑事项" : "新增事项"} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <header><h3>{editing ? "编辑事项" : `新增 ${draft.kind}`}</h3><button type="button" onClick={() => {
        if (["dirty", "saving", "error"].includes(status) && !window.confirm("仍有未保存修改，确定离开吗？")) return;
        setEditorOpen(false);
      }}>关闭</button></header>
      <label>事项类型<select aria-label="事项类型" value={draft.kind} onChange={(event) => update("kind", event.target.value as ItemKind)}>
        <option value="activity">Activity</option><option value="attraction">Attraction</option><option value="dining">Dining</option><option value="accommodation">Hotel</option><option value="transport">Transport</option><option value="other">Other</option>
      </select></label>
      <label>事项名称<input value={draft.target} onChange={(event) => update("target", event.target.value)} /></label>
      <label>描述<textarea value={draft.description} onChange={(event) => update("description", event.target.value)} /></label>
      <div className="formRow">
        <label>时间类型<select value={draft.timeKind} onChange={(event) => update("timeKind", event.target.value as ItemDraft["timeKind"])}><option value="unscheduled">未排期</option><option value="clock">时刻</option><option value="range">范围</option><option value="period">时段</option></select></label>
        {draft.timeKind === "period" ? <label>时段<select value={draft.timePeriod} onChange={(event) => update("timePeriod", event.target.value)}><option value="">请选择</option><option value="morning">morning</option><option value="noon">noon</option><option value="afternoon">afternoon</option><option value="evening">evening</option><option value="night">night</option></select></label> : null}
        {draft.timeKind === "clock" || draft.timeKind === "range" ? <label>开始时间<input type="time" value={draft.startTime} onChange={(event) => update("startTime", event.target.value)} /></label> : null}
        {draft.timeKind === "range" ? <label>结束时间<input type="time" value={draft.endTime} onChange={(event) => update("endTime", event.target.value)} /></label> : null}
      </div>
      {draft.timeKind === "range" ? <label><input type="checkbox" checked={draft.crossesMidnight} onChange={(event) => update("crossesMidnight", event.target.checked)} />跨午夜</label> : null}
      <label>时长（分钟）<input type="number" min="0" value={draft.durationMinutes ?? ""} onChange={(event) => update("durationMinutes", event.target.value ? Number(event.target.value) : undefined)} /></label>
      {draft.kind !== "transport" ? <LocationProductPicker
        tripId={tripId}
        locationId={draft.locationId}
        initialText={draft.locationText}
        onLocationChange={(locationId, inputText) => {
          update("locationId", locationId);
          update("locationText", inputText);
        }}
      /> : null}
      {draft.kind !== "transport" ? <label>入站交通方式<select aria-label="入站交通方式" value={draft.transportModeId} onChange={(event) => update("transportModeId", event.target.value)}><option value="">未指定（OTHER）</option>{modeCatalog.filter((mode) => mode.enabled || mode.code === draft.transportModeId).map((mode) => <option key={mode.code} value={mode.code} disabled={!mode.enabled}>{mode.label}{mode.enabled ? "" : "（已停用）"}</option>)}</select></label> : null}
      {draft.kind === "dining" ? <fieldset><legend>餐饮信息</legend><label>餐厅<input value={draft.diningName} required onChange={(event) => update("diningName", event.target.value)} /></label><label>餐别<select value={draft.mealType} onChange={(event) => update("mealType", event.target.value)}><option value="">未指定</option><option value="breakfast">breakfast</option><option value="lunch">lunch</option><option value="dinner">dinner</option><option value="snack">snack</option></select></label></fieldset> : null}
      {draft.kind === "accommodation" ? <fieldset><legend>住宿信息</legend><label>住宿名称<input value={draft.hotelName} required onChange={(event) => update("hotelName", event.target.value)} /></label><label>住宿详情<input value={draft.accommodationType} onChange={(event) => update("accommodationType", event.target.value)} /></label><div className="formRow"><label>入住日期<input type="date" value={draft.checkInDate} onChange={(event) => update("checkInDate", event.target.value)} /></label><label>退房日期<input type="date" value={draft.checkOutDate} onChange={(event) => update("checkOutDate", event.target.value)} /></label></div></fieldset> : null}
      {draft.kind === "transport" ? <>
        <LocationProductPicker tripId={tripId} locationId={draft.transportOrigin} legend="交通起点" inputLabel="起点地点文字" onLocationChange={(locationId) => update("transportOrigin", locationId)} />
        <LocationProductPicker tripId={tripId} locationId={draft.transportDestination} legend="交通终点" inputLabel="终点地点文字" onLocationChange={(locationId) => update("transportDestination", locationId)} />
        <label>交通方式<select aria-label="交通方式" required value={draft.transportModeId} onChange={(event) => update("transportModeId", event.target.value)}><option value="">请选择</option>{modeCatalog.filter((mode) => mode.enabled || mode.code === draft.transportModeId).map((mode) => <option key={mode.code} value={mode.code} disabled={!mode.enabled}>{mode.label}{mode.enabled ? "" : "（已停用）"}</option>)}</select></label>
      </> : null}
      <fieldset><legend>预订与联系</legend><label>预订编号<input value={draft.reservationReference} onChange={(event) => update("reservationReference", event.target.value)} /></label><div className="formRow"><label>联系人<input value={draft.contactName} onChange={(event) => update("contactName", event.target.value)} /></label><label>联系电话<input value={draft.contactPhone} onChange={(event) => update("contactPhone", event.target.value)} /></label></div></fieldset>
      <fieldset disabled={expenseLoading}><legend>费用</legend><div className="formRow"><label>金额<input inputMode="decimal" value={draft.costAmount} onChange={(event) => update("costAmount", event.target.value)} /></label><label>币种<input value={draft.costCurrency} onChange={(event) => update("costCurrency", event.target.value.toUpperCase())} /></label><label>类别<input value={draft.costCategory} onChange={(event) => update("costCategory", event.target.value.toUpperCase())} /></label></div>{expenseLoading ? <p role="status">正在载入事项费用…</p> : null}</fieldset>
      <label>备注<textarea value={draft.notes} onChange={(event) => update("notes", event.target.value)} /></label>
      <footer><button className="primary" type="submit" disabled={status === "saving"}>{status === "saving" ? "正在保存…" : "保存事项"}</button><span role="status">{status === "dirty" ? "有未保存更改" : status === "saving" ? "正在保存…" : status === "saved" ? "已保存" : status === "error" ? "保存失败" : ""}</span></footer>
    </form> : null}
  </section>;
}
