"use client";

import { transportModes } from "@on-the-road/config/reference-data";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EditorDraft, ItemKind } from "./item-editor";

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
    checkInAt?: string | null;
    checkOutAt?: string | null;
    bookingInfo?: unknown;
    contactInfo?: unknown;
  } | null;
  version: number;
};

type ItemDraft = EditorDraft & { kind: ItemKind };

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

export function ItineraryPanel({ tripId }: { readonly tripId: string }) {
  const [days, setDays] = useState<ProductDay[]>([]);
  const [selectedDayId, setSelectedDayId] = useState("");
  const [items, setItems] = useState<ProductItem[]>([]);
  const [draft, setDraft] = useState<ItemDraft>(() => emptyDraft());
  const [editing, setEditing] = useState<ProductItem | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "dirty" | "saving" | "saved" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const confirmedPayload = useRef("");
  const saveSequence = useRef(0);

  const loadItems = useCallback(async (dayId: string) => {
    setStatus("loading");
    try {
      setItems(await itineraryApi<ProductItem[]>(`/trips/${tripId}/days/${dayId}/itinerary-items`));
      setError(null);
      setStatus("idle");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法载入当天行程");
      setStatus("error");
    }
  }, [tripId]);

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
  }

  function beginEdit(item: ProductItem) {
    const nextDraft = itemDraft(item);
    setEditing(item);
    setDraft(nextDraft);
    confirmedPayload.current = JSON.stringify(itemPayload(nextDraft));
    setEditorOpen(true);
    setError(null);
    setStatus("idle");
  }

  const persistEdit = useCallback(async (
    item: ProductItem,
    snapshot: ItemDraft,
    sequence: number,
  ) => {
    setStatus("saving");
    setError(null);
    try {
      const saved = await itineraryApi<ProductItem>(`/trips/${tripId}/itinerary-items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "if-match": String(item.version) },
        body: JSON.stringify(itemPayload(snapshot)),
      });
      if (sequence !== saveSequence.current) return;
      confirmedPayload.current = JSON.stringify(itemPayload(snapshot));
      setEditing(saved);
      setItems((current) => current.map((entry) => entry.id === saved.id ? saved : entry));
      setStatus("saved");
    } catch (caught) {
      if (sequence !== saveSequence.current) return;
      setError(caught instanceof Error ? caught.message : "保存失败");
      setStatus("error");
    }
  }, [tripId]);

  useEffect(() => {
    if (!editorOpen || !editing) return;
    const serialized = JSON.stringify(itemPayload(draft));
    if (serialized === confirmedPayload.current) return;
    setStatus("dirty");
    const sequence = ++saveSequence.current;
    const timer = window.setTimeout(() => {
      void persistEdit(editing, structuredClone(draft), sequence);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draft, editing, editorOpen, persistEdit]);

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
      confirmedPayload.current = JSON.stringify(itemPayload(draft));
      setStatus("saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
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
    {error ? <p role="alert" className="formError">{error}</p> : null}
    {status === "loading" ? <p role="status">正在载入行程…</p> : null}
    <ol className="productTimeline" aria-label={`Day ${selectedDay?.dayNumber ?? ""} 时间线`}>
      {items.map((item) => <li key={item.id}>
        <button type="button" onClick={() => beginEdit(item)}>
          <strong>{item.target || item.description}</strong>
          <span>{item.itemType} · {item.timeKind === "period" ? item.timePeriod : item.startTime || "未排期"}</span>
        </button>
      </li>)}
    </ol>
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
      {draft.kind === "dining" ? <fieldset><legend>餐饮信息</legend><label>餐厅<input value={draft.diningName} required onChange={(event) => update("diningName", event.target.value)} /></label><label>餐别<select value={draft.mealType} onChange={(event) => update("mealType", event.target.value)}><option value="">未指定</option><option value="breakfast">breakfast</option><option value="lunch">lunch</option><option value="dinner">dinner</option><option value="snack">snack</option></select></label></fieldset> : null}
      {draft.kind === "accommodation" ? <fieldset><legend>住宿信息</legend><label>住宿名称<input value={draft.hotelName} required onChange={(event) => update("hotelName", event.target.value)} /></label><div className="formRow"><label>入住日期<input type="date" value={draft.checkInDate} onChange={(event) => update("checkInDate", event.target.value)} /></label><label>退房日期<input type="date" value={draft.checkOutDate} onChange={(event) => update("checkOutDate", event.target.value)} /></label></div></fieldset> : null}
      {draft.kind === "transport" ? <label>交通方式<select required value={draft.transportModeId} onChange={(event) => update("transportModeId", event.target.value)}><option value="">请选择</option>{transportModes.map((mode) => <option key={mode.code} value={mode.code}>{mode.label}</option>)}</select></label> : null}
      <fieldset><legend>预订与联系</legend><label>预订编号<input value={draft.reservationReference} onChange={(event) => update("reservationReference", event.target.value)} /></label><div className="formRow"><label>联系人<input value={draft.contactName} onChange={(event) => update("contactName", event.target.value)} /></label><label>联系电话<input value={draft.contactPhone} onChange={(event) => update("contactPhone", event.target.value)} /></label></div></fieldset>
      {!editing ? <fieldset><legend>费用</legend><div className="formRow"><label>金额<input inputMode="decimal" value={draft.costAmount} onChange={(event) => update("costAmount", event.target.value)} /></label><label>币种<input value={draft.costCurrency} onChange={(event) => update("costCurrency", event.target.value.toUpperCase())} /></label><label>类别<input value={draft.costCategory} onChange={(event) => update("costCategory", event.target.value.toUpperCase())} /></label></div></fieldset> : null}
      <label>备注<textarea value={draft.notes} onChange={(event) => update("notes", event.target.value)} /></label>
      <footer><button className="primary" type="submit" disabled={status === "saving"}>{status === "saving" ? "正在保存…" : "保存事项"}</button><span role="status">{status === "dirty" ? "有未保存更改" : status === "saving" ? "正在保存…" : status === "saved" ? "已保存" : status === "error" ? "保存失败" : ""}</span></footer>
    </form> : null}
  </section>;
}
