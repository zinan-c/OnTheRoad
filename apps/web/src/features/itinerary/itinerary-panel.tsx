"use client";

import { transportModes } from "@on-the-road/config/reference-data";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EditorDraft, ItemKind } from "./item-editor";
import {
  ProductSortableTimeline,
  type ProductReorderInput,
} from "./product-sortable-timeline";
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
  remark: string | null;
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
    throw Object.assign(new Error(problem?.detail ?? problem?.title ?? `Request failed: ${response.status}`), {
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
    costRemark: "",
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
      remark: draft.costRemark,
    },
  });
}

export function ItineraryPanel({
  tripId,
  selectedDayId: controlledSelectedDayId,
  onSelectedDayChange,
  onTransportModesChange,
  onItemsChange,
  onRoutesInvalidated,
}: {
  readonly tripId: string;
  readonly selectedDayId?: string | null;
  readonly onSelectedDayChange?: (dayId: string) => void;
  readonly onTransportModesChange?: (modes: TransportModeView[]) => void;
  readonly onItemsChange?: (dayId: string, items: ProductItem[]) => void;
  readonly onRoutesInvalidated?: () => void;
}) {
  const [days, setDays] = useState<ProductDay[]>([]);
  const [localSelectedDayId, setLocalSelectedDayId] = useState("");
  const [items, setItems] = useState<ProductItem[]>([]);
  const [draft, setDraft] = useState<ItemDraft>(() => emptyDraft());
  const [editing, setEditing] = useState<ProductItem | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "dirty" | "saving" | "saved" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
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
  const selectedDayId = controlledSelectedDayId ?? localSelectedDayId;

  const loadItems = useCallback(async (dayId: string) => {
    setStatus("loading");
    try {
      const loaded = await itineraryApi<ProductItem[]>(`/trips/${tripId}/days/${dayId}/itinerary-items`);
      setItems(loaded);
      onItemsChange?.(dayId, loaded);
      setError(null);
      setStatus("idle");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load this day's itinerary");
      setStatus("error");
    }
  }, [onItemsChange, tripId]);

  const selectDay = useCallback((dayId: string) => {
    setLocalSelectedDayId(dayId);
    onSelectedDayChange?.(dayId);
    setEditorOpen(false);
    void loadItems(dayId);
  }, [loadItems, onSelectedDayChange]);

  useEffect(() => {
    void itineraryApi<ProductDay[]>(`/trips/${tripId}/days`).then((loaded) => {
      setDays(loaded);
      const first = loaded[0]?.id ?? "";
      setLocalSelectedDayId(first);
      if (first) {
        onSelectedDayChange?.(first);
        void loadItems(first);
      }
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Unable to load trip days");
      setStatus("error");
    });
  }, [loadItems, onSelectedDayChange, tripId]);

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
      setError(caught instanceof Error ? caught.message : "Unable to load transport modes");
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
        costRemark: primary.remark ?? "",
      } : nextDraft;
      confirmedPayload.current = draftFingerprint(withExpense);
      setDraft((current) => ({
        ...current,
        costAmount: withExpense.costAmount,
        costCurrency: withExpense.costCurrency,
        costRemark: withExpense.costRemark,
      }));
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Unable to load item expenses");
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
              body: JSON.stringify({ amount: snapshot.costAmount, currency: snapshot.costCurrency, remark: snapshot.costRemark.trim() || null }),
            })
          : await itineraryApi<ProductExpense>(`/trips/${tripId}/expenses`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ itineraryItemId: item.id, amount: snapshot.costAmount, currency: snapshot.costCurrency, remark: snapshot.costRemark.trim() || null }),
            });
      }
      if (sequence !== saveSequence.current) return;
      confirmedPayload.current = draftFingerprint(snapshot);
      setEditing(saved);
      setItems((current) => {
        const next = current.map((entry) => entry.id === saved.id ? saved : entry);
        onItemsChange?.(saved.tripDayId, next);
        return next;
      });
      setStatus("saved");
    } catch (caught) {
      if (sequence !== saveSequence.current) return;
      setError(caught instanceof Error ? caught.message : "Save failed");
      setStatus("error");
    }
  }, [onItemsChange, onRoutesInvalidated, tripId]);

  useEffect(() => {
    if (!editorOpen || !editing || expenseLoading) return;
    const serialized = draftFingerprint(draft);
    if (serialized === confirmedPayload.current) {
      setStatus((current) => current === "dirty" ? "saved" : current);
      return;
    }
    setStatus("dirty");
  }, [draft, editing, editorOpen, expenseLoading]);

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
      setError("Enter an item name or description.");
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
            remark: draft.costRemark.trim() || null,
          }),
        });
      }
      await loadItems(selectedDayId);
      setEditing(saved);
      confirmedPayload.current = draftFingerprint(draft);
      setStatus("saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed");
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
      setError(caught instanceof Error ? caught.message : "Copy failed");
      setStatus("error");
    }
  }

  async function deleteItem(item: ProductItem) {
    if (!window.confirm(`Delete “${item.target || item.description}”?`)) return;
    setStatus("saving");
    setError(null);
    try {
      await itineraryApi(`/trips/${tripId}/itinerary-items/${item.id}`, {
        method: "DELETE",
        headers: { "if-match": String(item.version) },
      });
      setItems((current) => {
        const next = current.filter(({ id }) => id !== item.id);
        onItemsChange?.(item.tripDayId, next);
        return next;
      });
      if (editing?.id === item.id) {
        setEditorOpen(false);
        setEditing(null);
      }
      setStatus("saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Delete failed");
      setStatus("error");
    }
  }

  async function reorderItems(orderedIds: string[], input: ProductReorderInput) {
    if (!selectedDay || selectedDay.version === undefined) {
      setError("This day has no version information, so it cannot be reordered safely.");
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
      const reordered = saved.orderedIds.map((id) => savedById.get(id)!).filter(Boolean);
      setItems(reordered);
      onItemsChange?.(saved.tripDayId, reordered);
      setDays((current) => current.map((day) => day.id === saved.tripDayId
        ? { ...day, version: saved.version }
        : day));
      setStatus("saved");
    } catch (caught) {
      setItems(previous);
      setError(caught instanceof Error ? `${input} reorder failed: ${caught.message}` : "Reorder failed; the previous order was restored.");
      setStatus("error");
    }
  }

  return <section className="workspaceCard itineraryProduct" aria-label="Daily itinerary">
    <header>
      <h2>Daily itinerary</h2>
      <p>Select a day, review its details, and explicitly save or cancel edits.</p>
    </header>
    <nav className="dayTabs" aria-label="Select day">
      {days.map((day) => <button key={day.id} type="button" aria-pressed={day.id === selectedDayId} onClick={() => {
        selectDay(day.id);
      }}>Day {day.dayNumber}</button>)}
    </nav>
    <div className="itemCreateActions" aria-label="Item actions">
      <button type="button" onClick={() => beginCreate("activity")}>Add item</button>
    </div>
    {error ? <p role="alert" className="formError">{error}</p> : null}
    {status === "loading" ? <p role="status">Loading itinerary…</p> : null}
    <ProductSortableTimeline
      entries={items.map((item) => ({ id: item.id, label: item.target || item.description || "Untitled item" }))}
      disabled={status === "saving"}
      label={`Day ${selectedDay?.dayNumber ?? ""} timeline`}
      onReorder={(orderedIds, input) => void reorderItems(orderedIds, input)}
    >{(id) => {
      const item = items.find((entry) => entry.id === id)!;
      return <>
        <button id={`itinerary-item-edit-${item.id}`} className="timelineEditButton" type="button" aria-label={`Edit ${item.target || item.description}`} onClick={() => beginEdit(item)}>
          <strong>{item.target || item.description}</strong><span>{item.itemType} · {item.timeKind === "period" ? item.timePeriod : item.startTime || "Unscheduled"}</span>
        </button>
        <label>Copy to<select id={`itinerary-item-copy-${item.id}`} aria-label={`Copy ${item.target || item.description} to`} defaultValue="" onChange={(event) => {
          const target = event.target.value;
          event.target.value = "";
          void copyItem(item, target);
        }}><option value="">Select day</option>{days.map((day) => <option key={day.id} value={day.id}>Day {day.dayNumber}</option>)}</select></label>
        <button id={`itinerary-item-delete-${item.id}`} type="button" aria-label={`Delete ${item.target || item.description}`} onClick={() => void deleteItem(item)}>Delete</button>
      </>;
    }}</ProductSortableTimeline>
    {!editorOpen && status !== "idle" && status !== "loading" ? <p role="status">
      {status === "saving" ? "Saving order…" : status === "saved" ? "Saved" : status === "error" ? "Unable to save order" : ""}
    </p> : null}
    {editorOpen ? <form className="itemEditorForm" aria-label={editing ? "Edit item" : "Add item"} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <header><h3>{editing ? "Edit item" : `Add ${draft.kind}`}</h3><button type="button" onClick={() => {
        if (["dirty", "saving", "error"].includes(status) && !window.confirm("Discard unsaved changes?")) return;
        setEditorOpen(false);
      }}>Cancel</button></header>
      <label>Item type<select aria-label="Item type" value={draft.kind} onChange={(event) => {
        const kind = event.target.value as ItemKind;
        update("kind", kind);
        if (kind === "transport") void loadTransportModes();
      }}>
        <option value="activity">Activity</option><option value="attraction">Attraction</option><option value="dining">Dining</option><option value="accommodation">Hotel</option><option value="transport">Transport</option><option value="other">Other</option>
      </select></label>
      <label>Item name<input value={draft.target} onChange={(event) => update("target", event.target.value)} /></label>
      <label>Description<textarea value={draft.description} onChange={(event) => update("description", event.target.value)} /></label>
      <div className="formRow">
        <label>Time type<select value={draft.timeKind} onChange={(event) => update("timeKind", event.target.value as ItemDraft["timeKind"])}><option value="unscheduled">Unscheduled</option><option value="clock">Time</option><option value="range">Range</option><option value="period">Period</option></select></label>
        {draft.timeKind === "period" ? <label>Period<select value={draft.timePeriod} onChange={(event) => update("timePeriod", event.target.value)}><option value="">Select</option><option value="morning">Morning</option><option value="noon">Noon</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option><option value="night">Night</option></select></label> : null}
        {draft.timeKind === "clock" || draft.timeKind === "range" ? <label>Start time<input type="time" value={draft.startTime} onChange={(event) => update("startTime", event.target.value)} /></label> : null}
        {draft.timeKind === "range" ? <label>End time<input type="time" value={draft.endTime} onChange={(event) => update("endTime", event.target.value)} /></label> : null}
      </div>
      {draft.timeKind === "range" ? <label><input type="checkbox" checked={draft.crossesMidnight} onChange={(event) => update("crossesMidnight", event.target.checked)} />Crosses midnight</label> : null}
      <label>Duration (minutes)<input type="number" min="0" value={draft.durationMinutes ?? ""} onChange={(event) => update("durationMinutes", event.target.value ? Number(event.target.value) : undefined)} /></label>
      {draft.kind !== "transport" ? <LocationProductPicker
        tripId={tripId}
        locationId={draft.locationId}
        initialText={draft.locationText}
        onLocationChange={(locationId, inputText) => {
          update("locationId", locationId);
          update("locationText", inputText);
        }}
      /> : null}
      {draft.kind !== "transport" ? <label>Inbound transport mode<select aria-label="Inbound transport mode" value={draft.transportModeId} onChange={(event) => update("transportModeId", event.target.value)}><option value="">Unspecified (OTHER)</option>{modeCatalog.filter((mode) => mode.enabled || mode.code === draft.transportModeId).map((mode) => <option key={mode.code} value={mode.code} disabled={!mode.enabled}>{mode.code}{mode.enabled ? "" : " (disabled)"}</option>)}</select></label> : null}
      {draft.kind === "dining" ? <fieldset><legend>Dining details</legend><label>Restaurant<input value={draft.diningName} required onChange={(event) => update("diningName", event.target.value)} /></label><label>Meal<select value={draft.mealType} onChange={(event) => update("mealType", event.target.value)}><option value="">Unspecified</option><option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option><option value="snack">Snack</option></select></label></fieldset> : null}
      {draft.kind === "accommodation" ? <fieldset><legend>Accommodation details</legend><label>Property name<input value={draft.hotelName} required onChange={(event) => update("hotelName", event.target.value)} /></label><label>Details<input value={draft.accommodationType} onChange={(event) => update("accommodationType", event.target.value)} /></label><div className="formRow"><label>Check-in date<input type="date" value={draft.checkInDate} onChange={(event) => update("checkInDate", event.target.value)} /></label><label>Check-out date<input type="date" value={draft.checkOutDate} onChange={(event) => update("checkOutDate", event.target.value)} /></label></div></fieldset> : null}
      {draft.kind === "transport" ? <>
        <LocationProductPicker tripId={tripId} locationId={draft.transportOrigin} legend="Transport origin" inputLabel="Origin location" onLocationChange={(locationId) => update("transportOrigin", locationId)} />
        <LocationProductPicker tripId={tripId} locationId={draft.transportDestination} legend="Transport destination" inputLabel="Destination location" onLocationChange={(locationId) => update("transportDestination", locationId)} />
        <label>Transport mode<select aria-label="Transport mode" required value={draft.transportModeId} onChange={(event) => update("transportModeId", event.target.value)}><option value="">Select</option>{modeCatalog.filter((mode) => mode.enabled || mode.code === draft.transportModeId).map((mode) => <option key={mode.code} value={mode.code} disabled={!mode.enabled}>{mode.code}{mode.enabled ? "" : " (disabled)"}</option>)}</select></label>
      </> : null}
      <fieldset><legend>Booking and contact</legend><label>Booking reference<input value={draft.reservationReference} onChange={(event) => update("reservationReference", event.target.value)} /></label><div className="formRow"><label>Contact name<input value={draft.contactName} onChange={(event) => update("contactName", event.target.value)} /></label><label>Contact phone<input value={draft.contactPhone} onChange={(event) => update("contactPhone", event.target.value)} /></label></div></fieldset>
      <fieldset disabled={expenseLoading}><legend>Expense</legend><div className="formRow"><label>Amount<input inputMode="decimal" value={draft.costAmount} onChange={(event) => update("costAmount", event.target.value)} /></label><label>Currency<input value={draft.costCurrency} onChange={(event) => update("costCurrency", event.target.value.toUpperCase())} /></label></div><label>Expense remark<input value={draft.costRemark} onChange={(event) => update("costRemark", event.target.value)} /></label>{expenseLoading ? <p role="status">Loading item expense…</p> : null}</fieldset>
      <label className="itemNotesField"><span>Notes</span><textarea rows={6} value={draft.notes} onChange={(event) => update("notes", event.target.value)} /></label>
      <footer><button className="primary" type="submit" disabled={status === "saving"}>{status === "saving" ? "Saving…" : "Save item"}</button><button className="secondary" type="button" disabled={status === "saving"} onClick={() => setEditorOpen(false)}>Cancel</button><span role="status">{status === "dirty" ? "Unsaved changes" : status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Save failed" : ""}</span></footer>
    </form> : null}
  </section>;
}
