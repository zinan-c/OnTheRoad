"use client";

import { currencies, transportModes } from "@on-the-road/config/reference-data";
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
    target: item.target ?? item.dining?.name ?? item.accommodation?.name ?? "",
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

function itemLabel(item: ProductItem): string {
  return item.target || item.dining?.name || item.accommodation?.name || "Untitled item";
}

function itemTimeLabel(item: ProductItem): string {
  if (item.timeKind === "period") return item.timePeriod || "Unscheduled";
  if (item.timeKind === "range" && item.startTime && item.endTime) {
    return `${item.startTime}–${item.endTime}${item.endDayOffset === 1 ? " · next day" : ""}`;
  }
  return item.startTime || "Unscheduled";
}

function displayDate(value?: string): string {
  if (!value) return "Date not set";
  const date = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return value;
  const monthDay = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date);
  return `${monthDay} · ${weekday}`;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function ItineraryPanel({
  tripId,
  selectedDayId: controlledSelectedDayId,
  onSelectedDayChange,
  onDaySelect,
  onTransportModesChange,
  onItemsChange,
  onRoutesInvalidated,
  variant = "legacy",
}: {
  readonly tripId: string;
  readonly selectedDayId?: string | null;
  readonly onSelectedDayChange?: (dayId: string) => void;
  readonly onDaySelect?: (dayId: string) => void;
  readonly onTransportModesChange?: (modes: TransportModeView[]) => void;
  readonly onItemsChange?: (dayId: string, items: ProductItem[]) => void;
  readonly onRoutesInvalidated?: () => void;
  readonly variant?: "legacy" | "workspace";
}) {
  const workspaceMode = variant === "workspace";
  const [days, setDays] = useState<ProductDay[]>([]);
  const [localSelectedDayId, setLocalSelectedDayId] = useState("");
  const [items, setItems] = useState<ProductItem[]>([]);
  const [itemExpenses, setItemExpenses] = useState<Record<string, ProductExpense>>({});
  const [draft, setDraft] = useState<ItemDraft>(() => emptyDraft());
  const [editing, setEditing] = useState<ProductItem | null>(null);
  const [viewing, setViewing] = useState<ProductItem | null>(null);
  const [viewingExpense, setViewingExpense] = useState<ProductExpense | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [workspaceEditing, setWorkspaceEditing] = useState(false);
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
  const workspaceOriginalOrder = useRef<string[]>([]);
  const selectedDayId = controlledSelectedDayId !== undefined
    ? controlledSelectedDayId
    : localSelectedDayId;

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

  const loadWorkspaceItems = useCallback(async (
    dayId: string | null,
    availableDays: readonly ProductDay[],
  ) => {
    setStatus("loading");
    try {
      const selectedDays = dayId
        ? availableDays.filter((day) => day.id === dayId)
        : availableDays;
      const itemGroups = await Promise.all(selectedDays.map(async (day) => ({
        day,
        items: await itineraryApi<ProductItem[]>(`/trips/${tripId}/days/${day.id}/itinerary-items`),
      })));
      const loadedItems = itemGroups.flatMap(({ items: dayItems }) => dayItems);
      const expenseGroups = await Promise.all(loadedItems.map(async (item) => ({
        itemId: item.id,
        expenses: await itineraryApi<ProductExpense[]>(`/trips/${tripId}/itinerary-items/${item.id}/expenses`),
      })));
      const nextExpenses: Record<string, ProductExpense> = {};
      for (const { itemId, expenses } of expenseGroups) {
        const expense = expenses.find((candidate) => candidate.itineraryItemId === itemId);
        if (expense) nextExpenses[itemId] = expense;
      }
      setItems(loadedItems);
      setItemExpenses(nextExpenses);
      for (const { day, items: dayItems } of itemGroups) onItemsChange?.(day.id, dayItems);
      setError(null);
      setStatus("idle");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load this itinerary");
      setStatus("error");
    }
  }, [onItemsChange, tripId]);

  const selectDay = useCallback((dayId: string) => {
    setLocalSelectedDayId(dayId);
    onSelectedDayChange?.(dayId);
    onDaySelect?.(dayId);
    setEditorOpen(false);
    void loadItems(dayId);
  }, [loadItems, onDaySelect, onSelectedDayChange]);

  useEffect(() => {
    if (workspaceMode) return;
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
  }, [loadItems, onSelectedDayChange, tripId, workspaceMode]);

  useEffect(() => {
    if (!workspaceMode) return;
    let cancelled = false;
    setWorkspaceEditing(false);
    workspaceOriginalOrder.current = [];
    setEditorOpen(false);
    setEditing(null);
    setViewing(null);
    setViewingExpense(null);
    void itineraryApi<ProductDay[]>(`/trips/${tripId}/days`).then(async (loaded) => {
      if (cancelled) return;
      setDays(loaded);
      await loadWorkspaceItems(controlledSelectedDayId ?? null, loaded);
    }).catch((caught) => {
      if (cancelled) return;
      setError(caught instanceof Error ? caught.message : "Unable to load trip days");
      setStatus("error");
    });
    return () => { cancelled = true; };
  }, [controlledSelectedDayId, loadWorkspaceItems, tripId, workspaceMode]);

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

  async function openDetails(item: ProductItem) {
    setViewing(item);
    setViewingExpense(itemExpenses[item.id] ?? null);
    try {
      const loaded = await itineraryApi<ProductExpense[]>(`/trips/${tripId}/itinerary-items/${item.id}/expenses`);
      setViewingExpense(loaded.find((expense) => expense.itineraryItemId === item.id) ?? null);
    } catch {
      setViewingExpense(itemExpenses[item.id] ?? null);
    }
  }

  function enterWorkspaceEdit() {
    if (!selectedDayId) return;
    workspaceOriginalOrder.current = items.map(({ id }) => id);
    setWorkspaceEditing(true);
    setError(null);
    setStatus("idle");
  }

  function cancelWorkspaceEdit() {
    const order = workspaceOriginalOrder.current;
    if (order.length > 0) {
      const byId = new Map(items.map((item) => [item.id, item]));
      setItems(order.map((id) => byId.get(id)).filter((item): item is ProductItem => Boolean(item)));
    }
    setWorkspaceEditing(false);
    setError(null);
    setStatus("idle");
  }

  async function saveWorkspaceEdit() {
    if (!selectedDayId || !selectedDay || selectedDay.version === undefined) {
      setError("This day has no version information, so its order cannot be saved safely.");
      setStatus("error");
      return;
    }
    const orderedIds = items.map(({ id }) => id);
    if (JSON.stringify(orderedIds) === JSON.stringify(workspaceOriginalOrder.current)) {
      setWorkspaceEditing(false);
      setStatus("saved");
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      const saved = await itineraryApi<{ tripDayId: string; version: number; orderedIds: string[] }>(
        `/trips/${tripId}/days/${selectedDay.id}/itinerary-items/reorder`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ baseVersion: selectedDay.version, orderedIds }),
        },
      );
      const byId = new Map(items.map((item) => [item.id, item]));
      const reordered = saved.orderedIds.map((id) => byId.get(id)).filter((item): item is ProductItem => Boolean(item));
      setItems(reordered);
      onItemsChange?.(saved.tripDayId, reordered);
      setDays((current) => current.map((day) => day.id === saved.tripDayId
        ? { ...day, version: saved.version }
        : day));
      workspaceOriginalOrder.current = saved.orderedIds;
      setWorkspaceEditing(false);
      onRoutesInvalidated?.();
      setStatus("saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the itinerary order");
      setStatus("error");
    }
  }

  const persistEdit = useCallback(async (
    item: ProductItem,
    snapshot: ItemDraft,
    sequence: number,
  ): Promise<boolean> => {
    setStatus("saving");
    setError(null);
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
      if (sequence !== saveSequence.current) return false;
      confirmedPayload.current = draftFingerprint(snapshot);
      setEditing(saved);
      if (expenseRef.current) {
        setItemExpenses((current) => ({ ...current, [saved.id]: expenseRef.current! }));
      }
      setItems((current) => {
        const next = current.map((entry) => entry.id === saved.id ? saved : entry);
        onItemsChange?.(saved.tripDayId, next);
        return next;
      });
      onRoutesInvalidated?.();
      setStatus("saved");
      return true;
    } catch (caught) {
      if (sequence !== saveSequence.current) return false;
      setError(caught instanceof Error ? caught.message : "Save failed");
      setStatus("error");
      return false;
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
        const persisted = await persistEdit(editing, structuredClone(draft), sequence);
        if (workspaceMode && persisted) {
          setEditorOpen(false);
          setEditing(null);
        }
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
            remark: draft.costRemark.trim() || null,
          }),
        });
      }
      if (workspaceMode) {
        await loadWorkspaceItems(selectedDayId, days);
        setEditorOpen(false);
        setEditing(null);
      } else {
        await loadItems(selectedDayId);
        setEditing(saved);
      }
      onRoutesInvalidated?.();
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
      onRoutesInvalidated?.();
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
      onRoutesInvalidated?.();
      setItems((current) => {
        const next = current.filter(({ id }) => id !== item.id);
        onItemsChange?.(item.tripDayId, next);
        return next;
      });
      setItemExpenses((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      workspaceOriginalOrder.current = workspaceOriginalOrder.current.filter((id) => id !== item.id);
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
    if (workspaceMode && workspaceEditing) {
      const byId = new Map(items.map((item) => [item.id, item]));
      setItems(orderedIds.map((id) => byId.get(id)).filter((item): item is ProductItem => Boolean(item)));
      setStatus("dirty");
      return;
    }
    if (!selectedDay || selectedDay.version === undefined) {
      setError("This day has no version information, so it cannot be reordered safely.");
      return;
    }
    const previous = items;
    const byId = new Map(items.map((item) => [item.id, item]));
    setItems(orderedIds.map((id) => byId.get(id)!).filter(Boolean));
    setStatus("saving");
    setError(null);
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
      onRoutesInvalidated?.();
      setStatus("saved");
    } catch (caught) {
      setItems(previous);
      setError(caught instanceof Error ? `${input} reorder failed: ${caught.message}` : "Reorder failed; the previous order was restored.");
      setStatus("error");
    }
  }

  function closeEditor() {
    if (["dirty", "saving", "error"].includes(status) && !window.confirm("Discard unsaved changes?")) return;
    setEditorOpen(false);
    if (workspaceMode) setEditing(null);
  }

  const editorForm = editorOpen ? <form className="itemEditorForm" aria-label={editing ? "Edit item" : "Add item"} onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <header><h3>{editing ? "Edit item" : `Add ${draft.kind}`}</h3><button type="button" onClick={closeEditor}>Cancel</button></header>
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
    <fieldset disabled={expenseLoading}><legend>Expense</legend><div className="formRow"><label>Amount<input id="item-expense-amount" inputMode="decimal" value={draft.costAmount} onChange={(event) => update("costAmount", event.target.value)} /></label><label>Currency<select id="item-expense-currency" value={draft.costCurrency} onChange={(event) => update("costCurrency", event.target.value)}>{currencies.map(({ code }) => <option key={code} value={code}>{code}</option>)}</select></label></div><label>Expense remark<input id="item-expense-remark" value={draft.costRemark} onChange={(event) => update("costRemark", event.target.value)} /></label>{expenseLoading ? <p role="status">Loading item expense…</p> : null}</fieldset>
    <label className="itemNotesField"><span>Notes</span><textarea rows={6} value={draft.notes} onChange={(event) => update("notes", event.target.value)} /></label>
    <footer><button className="primary" type="submit" disabled={status === "saving"}>{status === "saving" ? "Saving…" : "Save item"}</button><button className="secondary" type="button" disabled={status === "saving"} onClick={closeEditor}>Cancel</button><span role="status">{status === "dirty" ? "Unsaved changes" : status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Save failed" : ""}</span></footer>
  </form> : null;

  if (workspaceMode) {
    const dayById = new Map(days.map((day) => [day.id, day]));
    return <section className="workspaceCard itineraryWorkspace" aria-label="Daily itinerary">
      <header className="workspaceItineraryHeader">
        <div>
          <p className="eyebrow">Itinerary</p>
          <h2>{selectedDay ? `Day ${selectedDay.dayNumber}` : "All days"}</h2>
          <p>{selectedDay ? displayDate(selectedDay.date) : "Global itinerary overview"}</p>
        </div>
        <div className="workspaceItineraryActions">
          {selectedDayId ? workspaceEditing ? <>
            <button className="secondary" type="button" onClick={cancelWorkspaceEdit}>Cancel</button>
            <button className="primary" type="button" onClick={() => void saveWorkspaceEdit()} disabled={status === "saving"}>Save</button>
          </> : <>
            <button className="secondary" type="button" onClick={enterWorkspaceEdit}>Edit</button>
            <button className="iconAddButton" type="button" aria-label="Add item" title="Add item" onClick={() => beginCreate("activity")}>+</button>
          </> : <span className="workspaceHint">Choose a Day to edit</span>}
        </div>
      </header>
      {error ? <p role="alert" className="formError">{error}</p> : null}
      {status === "loading" ? <p role="status">Loading itinerary…</p> : null}
      {items.length > 0 ? <ProductSortableTimeline
        entries={items.map((item) => ({ id: item.id, label: itemLabel(item) }))}
        disabled={!workspaceEditing || status === "saving"}
        showOrderControls={workspaceEditing}
        label={selectedDayId ? `Day ${selectedDay?.dayNumber ?? ""} itinerary` : "All days itinerary"}
        onReorder={(orderedIds, input) => void reorderItems(orderedIds, input)}
      >{(id) => {
        const item = items.find((entry) => entry.id === id);
        if (!item) return null;
        const day = dayById.get(item.tripDayId);
        const expense = itemExpenses[item.id];
        return <article className="workspaceItemCard" data-item-id={item.id}>
          <div className="workspaceItemMeta">
            {selectedDayId === null ? <span className="workspaceItemDay">Day {day?.dayNumber ?? "?"}</span> : null}
            <h3>{itemLabel(item)}</h3>
            <p>{item.description || "No description yet."}</p>
            {expense ? <span className="workspaceItemExpense">Expense · {displayAmount(expense.originalAmount)} {expense.currency}</span> : null}
          </div>
          <button className="workspaceItemAction" type="button" aria-label={`${workspaceEditing ? "Item edit" : "Expand"} ${itemLabel(item)}`} onClick={() => workspaceEditing ? beginEdit(item) : void openDetails(item)}>
            {workspaceEditing ? "Item edit" : "Expand"}
          </button>
        </article>;
      }}</ProductSortableTimeline> : status !== "loading" ? <p className="workspaceEmptyState">No itinerary items for this view yet.</p> : null}
      {editorForm ? <div className="workspaceDialogBackdrop" role="presentation"><div className="workspaceDialog" role="dialog" aria-modal="true" aria-label={editing ? "Edit item" : "Add item"}>{editorForm}</div></div> : null}
      {viewing ? <div className="workspaceDialogBackdrop" role="presentation"><section className="workspaceDialog" role="dialog" aria-modal="true" aria-label="Item details">
        <header className="workspaceDialogHeader"><div><p className="eyebrow">Item details</p><h2>{itemLabel(viewing)}</h2></div><button className="secondary" type="button" onClick={() => { setViewing(null); setViewingExpense(null); }}>Close</button></header>
        <dl className="workspaceItemDetails">
          <div><dt>Item type</dt><dd>{viewing.itemType}</dd></div>
          <div><dt>Description</dt><dd>{displayValue(viewing.description)}</dd></div>
          <div><dt>Time</dt><dd>{itemTimeLabel(viewing)}</dd></div>
          <div><dt>Duration</dt><dd>{viewing.durationMinutes === null ? "—" : `${viewing.durationMinutes} minutes`}</dd></div>
          <div><dt>Location</dt><dd>{displayValue(viewing.locationId)}</dd></div>
          <div><dt>Start location</dt><dd>{displayValue(viewing.startLocationId)}</dd></div>
          <div><dt>End location</dt><dd>{displayValue(viewing.endLocationId)}</dd></div>
          <div><dt>Transport mode</dt><dd>{displayValue(viewing.transportModeCode)}</dd></div>
          <div><dt>Booking</dt><dd>{displayValue(viewing.bookingInfo)}</dd></div>
          <div><dt>Contact</dt><dd>{displayValue(viewing.contactInfo)}</dd></div>
          <div><dt>Dining</dt><dd>{displayValue(viewing.dining)}</dd></div>
          <div><dt>Accommodation</dt><dd>{displayValue(viewing.accommodation)}</dd></div>
          <div><dt>Remark</dt><dd>{displayValue(viewing.remark)}</dd></div>
          <div><dt>Expense</dt><dd>{viewingExpense ? `${displayAmount(viewingExpense.originalAmount)} ${viewingExpense.currency}${viewingExpense.remark ? ` · ${viewingExpense.remark}` : ""}` : "—"}</dd></div>
        </dl>
      </section></div> : null}
    </section>;
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
    {editorForm}
  </section>;
}
