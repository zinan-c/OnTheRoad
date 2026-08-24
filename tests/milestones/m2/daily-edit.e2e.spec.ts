import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  PostgresItineraryOrderRepository,
} from "../../../apps/api/src/modules/itinerary/index.mjs";
import { PostgresTripRepository } from "../../../apps/api/src/modules/trips/postgres-repository.mjs";
import { TripService } from "../../../apps/api/src/modules/trips/service.mjs";
import {
  applyMigration,
  cleanOwner,
  itineraryDatabaseUrl,
  prepareItineraryDatabase,
  psql,
} from "../../../apps/api/test/itinerary/postgres-harness.mjs";
import {
  SortableTimelineController,
  SortableTimelineInputAdapter,
} from "../../../apps/web/src/features/itinerary/components/sortable-timeline.js";
import { ItineraryAutosave } from "../../../apps/web/src/features/itinerary/use-autosave.js";
import { ItineraryWorkspace } from "../../../apps/web/src/features/itinerary/workspace.js";
import { loadMinimalFiveDay } from "../../../packages/test-fixtures/src/index.mjs";
import { RealItineraryGateway } from "./real-itinerary-gateway.js";

const liveTest = itineraryDatabaseUrl ? test : test.skip;
const ownerId = `tc-m2-daily-${randomUUID()}`;
const otherOwnerId = `tc-m2-empty-other-${randomUUID()}`;
const encryptionSecret = "tc-m2-daily-edit-encryption-secret-at-least-32-bytes";
let tripId: string;
let gateway: RealItineraryGateway;
let fixture: Awaited<ReturnType<typeof loadMinimalFiveDay>>;

describe("TC-M2-INT-01 Daily edit and reorder persistence", () => {
  beforeAll(async () => {
    if (!itineraryDatabaseUrl) return;
    await prepareItineraryDatabase();
    if (!(await psql("SELECT to_regclass('public.job_outbox')"))) {
      await applyMigration("packages/database/src/migrations/0001_jobs.sql");
    }
    const managedSchema = Boolean(
      await psql("SELECT to_regclass('public.otr_schema_migration')"),
    );
    if (!managedSchema) {
      await applyMigration(
        "packages/database/src/migrations/0010_itinerary_reorder.sql",
      );
    }
    fixture = await loadMinimalFiveDay();
  });

  afterAll(async () => {
    await cleanOwner(ownerId);
    await cleanOwner(otherOwnerId);
  }, 60_000);

  liveTest(
    "creates the fixed five-day Trip from an empty account, edits a full Day, reorders three ways, rolls back 409, and reloads",
    async () => {
      const tripRepository = new PostgresTripRepository({
        databaseUrl: itineraryDatabaseUrl,
      });
      const tripService = new TripService(tripRepository);

      expect((await tripService.listTrips(ownerId)).items).toEqual([]);
      expect((await tripService.listTrips(otherOwnerId)).items).toEqual([]);

      const createdTrip = await tripService.createTrip(
        ownerId,
        {
          name: fixture.trip.name,
          startDate: fixture.trip.startDate,
          endDate: fixture.trip.endDate,
          travelers: 2,
          defaultCurrency: "CNY",
          timezone: fixture.trip.timezone,
          mapProfile: "cn_primary",
          description: `Gate fixture ${fixture.fixtureVersion}`,
          destinations: [
            { name: "上海", countryCode: "CN", city: "上海" },
            { name: "舟山与普陀山", countryCode: "CN", city: "舟山" },
          ],
        },
        { idempotencyKey: `m2-gate-${randomUUID()}` },
      );
      tripId = createdTrip.id;
      expect(createdTrip).toMatchObject({
        startDate: "2026-10-01",
        endDate: "2026-10-05",
        totalDays: 5,
      });
      await expect(tripService.getTrip(otherOwnerId, tripId))
        .rejects.toMatchObject({ status: 404 });

      gateway = new RealItineraryGateway({
        databaseUrl: itineraryDatabaseUrl,
        ownerId,
        tripId,
        encryptionSecret,
      });
      const workspace = new ItineraryWorkspace(gateway);
      await workspace.load(tripId);
      expect(workspace.state.days).toHaveLength(5);
      expect(workspace.state.items).toEqual([]);
      const dayId = workspace.state.selectedDayId!;
      const fixtureDay = fixture.trip.days[0]!;

      workspace.beginCreate("transport").update({
        target: fixtureDay.items[0]!.title,
        description: "固定 fixture 抵达交通",
        startTime: fixtureDay.items[0]!.startTime,
        endTime: fixtureDay.items[0]!.endTime,
        transportModeId: "METRO",
        transportOrigin: "浦东机场",
        transportDestination: "外滩",
        reservationReference: "TRANS-001",
        contactName: "接驳客服",
        contactPhone: "+86 21 1000 0001",
        notes: "从上一项到达本项的 Mode",
      });
      const transport = await workspace.save();

      workspace.beginCreate("accommodation").update({
        target: fixtureDay.items[1]!.title,
        description: "跨午夜住宿",
        startTime: "22:30",
        endTime: "07:30",
        crossesMidnight: true,
        hotelName: "外滩酒店（测试）",
        accommodationType: "hotel",
        checkInDate: "2026-10-01",
        checkOutDate: "2026-10-02",
        reservationReference: "HOTEL-001",
        contactName: "酒店前台",
        contactPhone: "+86 21 1000 0002",
        notes: "无烟房",
      });
      const hotel = await workspace.save();

      workspace.beginCreate("attraction").update({
        target: fixtureDay.items[2]!.title,
        description: "外滩完整字段",
        startTime: fixtureDay.items[2]!.startTime,
        endTime: fixtureDay.items[2]!.endTime,
        durationMinutes: 90,
        reservationReference: "ATTR-001",
        contactName: "票务",
        contactPhone: "+86 21 1000 0003",
        notes: "原始备注",
      });
      const attraction = await workspace.save();

      workspace.beginCreate("dining").update({
        target: fixture.trip.days[1]!.items[0]!.title,
        description: "早餐",
        startTime: "08:00",
        endTime: "09:00",
        diningName: "上海早餐店",
        mealType: "breakfast",
        reservationReference: "MEAL-001",
        contactName: "餐厅",
        contactPhone: "+86 21 1000 0004",
        notes: "少糖",
      });
      const dining = await workspace.save();

      workspace.beginCreate("activity").update({
        target: "自由散步",
        description: "未排地点的活动",
        notes: "可刷新恢复",
      });
      const activity = await workspace.save();

      const copied = await workspace.copy(dining.id, dayId);
      workspace.beginEdit(copied.id).update({
        target: "早餐（复制后修改）",
        notes: "副本已修改",
      });
      const updatedCopy = await workspace.save();
      await workspace.delete(dining.id);
      expect(await gateway.getItem(dining.id, { includeDeleted: true }))
        .toMatchObject({ deletedAt: expect.any(String), version: 2 });

      workspace.beginEdit(attraction.id);
      const autosave = new ItineraryAutosave(workspace.editor!, gateway, {
        debounceMs: 60_000,
      });
      autosave.update({ notes: "真实 Postgres autosave" });
      await autosave.flush();
      expect(autosave.state).toMatchObject({
        status: "saved",
        confirmedVersion: 2,
        dirtyFields: [],
      });
      autosave.dispose();

      const beforeOrder = await gateway.loadItems(tripId, dayId);
      expect(beforeOrder.map(({ id }) => id)).toEqual([
        transport.id,
        hotel.id,
        attraction.id,
        activity.id,
        updatedCopy.id,
      ]);
      const timeline = new SortableTimelineController({
        tripDayId: dayId,
        dayVersion: await gateway.loadDayVersion(dayId),
        items: beforeOrder.map(({ id, target }) => ({ id, target })),
        gateway,
      });
      const input = new SortableTimelineInputAdapter(timeline);

      await input.dragEnd({
        active: { id: updatedCopy.id },
        over: { id: transport.id },
        activatorEvent: { type: "pointerup", pointerType: "mouse" },
      });
      await input.dragEnd({
        active: { id: transport.id },
        over: { id: hotel.id },
        activatorEvent: { type: "touchend", pointerType: "touch" },
      });
      await input.keyboardMove(updatedCopy.id, "down");
      const afterThreeInputs = timeline.state.items.map(({ id }) => id);

      const staleTimeline = new SortableTimelineController({
        tripDayId: dayId,
        dayVersion: timeline.state.dayVersion,
        items: timeline.state.items,
        gateway,
      });
      const winnerOrder = [
        ...afterThreeInputs.slice(1),
        afterThreeInputs[0]!,
      ];
      const winningResult = await gateway.reorder({
        tripDayId: dayId,
        baseVersion: timeline.state.dayVersion,
        orderedIds: winnerOrder,
      });
      expect(winningResult.version).toBe(timeline.state.dayVersion + 1);
      const staleBefore = staleTimeline.state.items.map(({ id }) => id);
      await expect(
        staleTimeline.reorderByKeyboard(staleBefore[0]!, "down"),
      ).rejects.toMatchObject({
        code: "ITINERARY_ORDER_VERSION_CONFLICT",
        status: 409,
      });
      expect(staleTimeline.state.items.map(({ id }) => id)).toEqual(staleBefore);
      expect(staleTimeline.state.announcement).toContain("已恢复原顺序");

      const restartedGateway = new RealItineraryGateway({
        databaseUrl: itineraryDatabaseUrl,
        ownerId,
        tripId,
        encryptionSecret,
      });
      const refreshed = new ItineraryWorkspace(restartedGateway);
      await refreshed.load(tripId);
      expect(refreshed.state.days).toHaveLength(5);
      expect(refreshed.state.items.map(({ id }) => id)).toEqual(winnerOrder);
      const persisted = await restartedGateway.loadCanonicalItems(dayId);
      expect(persisted.find(({ id }) => id === hotel.id)).toMatchObject({
        itemType: "hotel",
        endDayOffset: 1,
        bookingInfo: "HOTEL-001",
        contactInfo: {
          name: "酒店前台",
          phone: "+86 21 1000 0002",
        },
        accommodation: {
          name: "外滩酒店（测试）",
          checkInAt: "2026-10-01T00:00:00.000000Z",
          checkOutAt: "2026-10-02T00:00:00.000000Z",
        },
      });
      expect(persisted.find(({ id }) => id === attraction.id)).toMatchObject({
        description: "外滩完整字段",
        durationMinutes: 90,
        remark: "真实 Postgres autosave",
        version: 2,
      });
      expect(persisted.find(({ id }) => id === updatedCopy.id)).toMatchObject({
        target: "早餐（复制后修改）",
        remark: "副本已修改",
        dining: {
          name: "上海早餐店",
          mealType: "breakfast",
        },
      });
      expect(persisted.find(({ id }) => id === transport.id)).toMatchObject({
        transportModeCode: "METRO",
        bookingInfo: "TRANS-001",
      });
      expect(
        JSON.parse(
          await psql(`SELECT jsonb_build_object(
            'days', (
              SELECT count(*) FROM trip_day WHERE trip_id = '${tripId}'
            ),
            'events', (
              SELECT count(*) FROM job_outbox
              WHERE aggregate_type = 'trip_day'
                AND aggregate_id = '${dayId}'
                AND event_type = 'itinerary.order.changed'
            )
          )::text`),
        ),
      ).toEqual({ days: 5, events: 4 });

      const directOrderRepository = new PostgresItineraryOrderRepository({
        databaseUrl: itineraryDatabaseUrl,
      });
      await expect(
        directOrderRepository.reorder(
          otherOwnerId,
          tripId,
          dayId,
          winningResult.version,
          winnerOrder,
        ),
      ).rejects.toMatchObject({
        code: "ITINERARY_ORDER_DAY_NOT_FOUND",
        status: 404,
      });
    },
    30_000,
  );
});
