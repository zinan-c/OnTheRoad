import { describe, expect, test } from "vitest";

import type { EditorPayload } from "../src/features/itinerary/item-editor.js";
import {
  ItineraryWorkspace,
  renderWorkspace,
  type TimelineItem,
  type TripDay,
} from "../src/features/itinerary/workspace.js";

const days: TripDay[] = [
  { id: "day-1", dayNumber: 1, date: "2026-10-01", destination: "上海" },
  { id: "day-2", dayNumber: 2, date: "2026-10-02", destination: "舟山" },
];

class FrozenItineraryGateway {
  readonly payloads: EditorPayload[] = [];
  readonly #items = new Map<string, TimelineItem[]>(
    days.map(({ id }) => [id, []]),
  );
  #sequence = 0;

  async listDays(): Promise<TripDay[]> {
    return structuredClone(days);
  }

  async loadItems(
    _tripId: string,
    dayId: string,
  ): Promise<TimelineItem[]> {
    return structuredClone(this.#items.get(dayId) ?? []);
  }

  async saveItem(
    payload: EditorPayload,
    context: { itemId?: string; version?: number },
  ): Promise<TimelineItem> {
    this.payloads.push(structuredClone(payload));
    const dayItems = this.#items.get(payload.tripDayId);
    if (!dayItems) throw new Error("Day not found");
    const existing = context.itemId
      ? dayItems.find(({ id }) => id === context.itemId)
      : undefined;
    if (
      existing
      && context.version !== undefined
      && existing.version !== context.version
    ) {
      throw Object.assign(new Error("version conflict"), { status: 409 });
    }
    const record: TimelineItem = {
      id: existing?.id ?? `item-${++this.#sequence}`,
      version: (existing?.version ?? 0) + 1,
      tripDayId: payload.tripDayId,
      kind: payload.kind,
      target: payload.target,
      ...(payload.description ? { description: payload.description } : {}),
      ...(payload.schedule.startTime
        ? { startTime: payload.schedule.startTime }
        : {}),
      ...(payload.schedule.endTime ? { endTime: payload.schedule.endTime } : {}),
      ...(payload.location?.text
        ? { locationText: payload.location.text }
        : {}),
      ...(payload.cost
        ? { costLabel: `${payload.cost.currency} ${payload.cost.amount}` }
        : {}),
      ...(payload.notes ? { notes: payload.notes } : {}),
    };
    if (existing) dayItems[dayItems.indexOf(existing)] = record;
    else dayItems.push(record);
    return structuredClone(record);
  }

  async copyItem(itemId: string, targetDayId: string): Promise<TimelineItem> {
    const source = [...this.#items.values()]
      .flat()
      .find(({ id }) => id === itemId);
    const target = this.#items.get(targetDayId);
    if (!source || !target) throw new Error("Copy source or target Day missing");
    const copied = {
      ...structuredClone(source),
      id: `item-${++this.#sequence}`,
      tripDayId: targetDayId,
      version: 1,
      target: `${source.target}（副本）`,
    };
    target.push(copied);
    return structuredClone(copied);
  }

  async deleteItem(itemId: string, version: number): Promise<void> {
    for (const items of this.#items.values()) {
      const index = items.findIndex(
        (item) => item.id === itemId && item.version === version,
      );
      if (index !== -1) {
        items.splice(index, 1);
        return;
      }
    }
    throw Object.assign(new Error("version conflict"), { status: 409 });
  }
}

describe("TC-B06-03 daily edit E2E", () => {
  test("adds multiple item types, refreshes, copies and deletes through the frozen contract", async () => {
    const gateway = new FrozenItineraryGateway();
    const firstSession = new ItineraryWorkspace(gateway);
    await firstSession.load("trip-1");

    firstSession.beginCreate("attraction").update({
      target: "外滩",
      startTime: "09:00",
      endTime: "10:30",
      locationText: "中山东一路",
      costAmount: "0",
      costCurrency: "CNY",
      notes: "清晨步行",
    });
    const attraction = await firstSession.save();

    firstSession.beginCreate("dining").update({
      target: "午餐",
      startTime: "12:00",
      diningName: "南翔馒头店",
      mealType: "lunch",
      costAmount: "168.50",
      costCurrency: "CNY",
      costRemark: "午餐",
    });
    const dining = await firstSession.save();

    firstSession.beginCreate("transport").update({
      target: "前往码头",
      startTime: "14:00",
      transportModeId: "metro",
      transportOrigin: "豫园",
      transportDestination: "码头",
    });
    await firstSession.save();

    expect(gateway.payloads).toHaveLength(3);
    expect(gateway.payloads.map(({ kind }) => kind)).toEqual([
      "attraction",
      "dining",
      "transport",
    ]);

    const refreshed = new ItineraryWorkspace(gateway);
    await refreshed.load("trip-1");
    expect(refreshed.state.items.map(({ target }) => target)).toEqual([
      "外滩",
      "午餐",
      "前往码头",
    ]);
    expect(renderWorkspace(refreshed.state, 1_440)).toContain("CNY 168.50");

    await refreshed.copy(attraction.id, "day-2");
    await refreshed.delete(dining.id);
    expect(refreshed.state.items.map(({ target }) => target)).toEqual([
      "外滩",
      "前往码头",
    ]);
    await refreshed.selectDay("day-2");
    expect(refreshed.state.items[0]?.target).toBe("外滩（副本）");
  });

  test("mobile segmented workspace completes a core accommodation edit", async () => {
    const gateway = new FrozenItineraryGateway();
    const workspace = new ItineraryWorkspace(gateway);
    await workspace.load("trip-1");
    workspace.setMobileSection("itinerary");
    workspace.beginCreate("accommodation").update({
      target: "舟山酒店",
      startTime: "20:00",
      hotelName: "舟山酒店",
      accommodationType: "hotel",
      checkInDate: "2026-10-01",
      checkOutDate: "2026-10-02",
      costAmount: "688",
      costCurrency: "CNY",
    });
    await workspace.save();

    const html = renderWorkspace(workspace.state, 390);
    expect(html).toContain('data-layout="mobile"');
    expect(html).toContain('aria-label="移动工作台"');
    expect(html).toContain("舟山酒店");
    expect(html).toContain('aria-pressed="true">行程');
  });
});
