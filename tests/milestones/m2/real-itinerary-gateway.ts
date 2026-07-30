import {
  ItineraryCipher,
  ItineraryOrderService,
  ItineraryService,
  PostgresItineraryOrderRepository,
  PostgresItineraryRepository,
} from "../../../apps/api/src/modules/itinerary/index.mjs";
import { PostgresTripDayRepository } from "../../../apps/api/src/modules/trips/postgres-day-repository.mjs";
import type { EditorPayload } from "../../../apps/web/src/features/itinerary/item-editor.js";
import type {
  ItineraryGateway,
  TimelineItem,
  TripDay,
} from "../../../apps/web/src/features/itinerary/workspace.js";
import type {
  ReorderRequest,
  ReorderResponse,
  SortableTimelineGateway,
} from "../../../apps/web/src/features/itinerary/components/sortable-timeline.js";

type CanonicalItem = {
  id: string;
  version: number;
  tripDayId: string;
  itemType: string;
  target: string | null;
  description: string | null;
  startTime: string | null;
  endTime: string | null;
  endDayOffset: number;
  durationMinutes: number | null;
  locationId: string | null;
  transportModeCode: string | null;
  bookingInfo: unknown;
  contactInfo: unknown;
  remark: string | null;
  dining: {
    name: string;
    mealType: string | null;
    details: string | null;
    locationId: string | null;
  } | null;
  accommodation: {
    name: string;
    details: string | null;
    locationId: string | null;
    checkInAt: string | null;
    checkOutAt: string | null;
    bookingInfo: unknown;
    contactInfo: unknown;
  } | null;
  deletedAt: string | null;
};

function sensitiveString(value: unknown, key: string): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record[key] === "string") return record[key];
  }
  return "";
}

function itemKind(itemType: string): TimelineItem["kind"] {
  if (itemType === "hotel") return "accommodation";
  if (
    itemType === "activity"
    || itemType === "attraction"
    || itemType === "dining"
    || itemType === "transport"
  ) {
    return itemType;
  }
  return "activity";
}

function toTimelineItem(item: CanonicalItem): TimelineItem {
  return {
    id: item.id,
    version: item.version,
    tripDayId: item.tripDayId,
    kind: itemKind(item.itemType),
    target: item.target ?? item.description ?? "未命名事项",
    ...(item.description ? { description: item.description } : {}),
    ...(item.startTime ? { startTime: item.startTime } : {}),
    ...(item.endTime ? { endTime: item.endTime } : {}),
    ...(item.remark ? { notes: item.remark } : {}),
    editorDraft: {
      ...(item.durationMinutes === null
        ? {}
        : { durationMinutes: item.durationMinutes }),
      ...(item.locationId ? { locationId: item.locationId } : {}),
      ...(item.transportModeCode
        ? { transportModeId: item.transportModeCode }
        : {}),
      crossesMidnight: item.endDayOffset === 1,
      ...(item.dining?.name ? { diningName: item.dining.name } : {}),
      ...(item.dining?.mealType ? { mealType: item.dining.mealType } : {}),
      ...(item.accommodation?.name
        ? { hotelName: item.accommodation.name, accommodationType: "hotel" }
        : {}),
      ...(item.accommodation?.checkInAt
        ? { checkInDate: item.accommodation.checkInAt.slice(0, 10) }
        : {}),
      ...(item.accommodation?.checkOutAt
        ? { checkOutDate: item.accommodation.checkOutAt.slice(0, 10) }
        : {}),
      ...(sensitiveString(item.bookingInfo, "reference")
        ? {
            reservationReference: sensitiveString(
              item.bookingInfo,
              "reference",
            ),
          }
        : {}),
      ...(sensitiveString(item.contactInfo, "name")
        ? { contactName: sensitiveString(item.contactInfo, "name") }
        : {}),
      ...(sensitiveString(item.contactInfo, "phone")
        ? { contactPhone: sensitiveString(item.contactInfo, "phone") }
        : {}),
    },
  };
}

export class RealItineraryGateway implements
  ItineraryGateway,
  SortableTimelineGateway
{
  readonly #ownerId: string;
  readonly #tripId: string;
  readonly #itemService: ItineraryService;
  readonly #orderService: ItineraryOrderService;
  readonly #dayRepository: PostgresTripDayRepository;

  constructor(input: {
    databaseUrl: string;
    ownerId: string;
    tripId: string;
    encryptionSecret: string;
  }) {
    this.#ownerId = input.ownerId;
    this.#tripId = input.tripId;
    this.#itemService = new ItineraryService(
      new PostgresItineraryRepository({ databaseUrl: input.databaseUrl }),
      new ItineraryCipher({
        activeKey: {
          id: "m2-gate-v1",
          secret: input.encryptionSecret,
        },
      }),
    );
    this.#orderService = new ItineraryOrderService(
      new PostgresItineraryOrderRepository({
        databaseUrl: input.databaseUrl,
      }),
    );
    this.#dayRepository = new PostgresTripDayRepository({
      databaseUrl: input.databaseUrl,
    });
  }

  async listDays(tripId: string): Promise<TripDay[]> {
    this.#assertTrip(tripId);
    const context = await this.#dayRepository.loadDateContext(
      this.#ownerId,
      this.#tripId,
    );
    return context.days.map((day: TripDay) => ({
      id: day.id,
      dayNumber: day.dayNumber,
      date: day.date,
    }));
  }

  async loadItems(
    tripId: string,
    dayId: string,
  ): Promise<TimelineItem[]> {
    this.#assertTrip(tripId);
    const items = await this.#itemService.listDay(
      this.#ownerId,
      this.#tripId,
      dayId,
    );
    return items.map(toTimelineItem);
  }

  async loadCanonicalItems(dayId: string): Promise<CanonicalItem[]> {
    return this.#itemService.listDay(
      this.#ownerId,
      this.#tripId,
      dayId,
    );
  }

  async loadDayVersion(dayId: string): Promise<number> {
    const context = await this.#dayRepository.loadDateContext(
      this.#ownerId,
      this.#tripId,
    );
    const day = context.days.find(({ id }: TripDay) => id === dayId);
    if (!day) throw new Error("TripDay not found");
    return day.version;
  }

  async saveItem(
    payload: EditorPayload,
    context: { itemId?: string; version?: number },
  ): Promise<TimelineItem> {
    this.#assertTrip(payload.tripId);
    const {
      contract: _contract,
      tripId: _tripId,
      tripDayId: _tripDayId,
      ...updatePatch
    } = payload;
    const saved = context.itemId
      ? await this.#itemService.update(
          this.#ownerId,
          this.#tripId,
          context.itemId,
          updatePatch,
          { expectedVersion: context.version },
        )
      : await this.#itemService.create(
          this.#ownerId,
          this.#tripId,
          payload,
        );
    return toTimelineItem(saved);
  }

  async deleteItem(itemId: string, version: number): Promise<void> {
    await this.#itemService.delete(
      this.#ownerId,
      this.#tripId,
      itemId,
      { expectedVersion: version },
    );
  }

  async copyItem(
    itemId: string,
    targetDayId: string,
  ): Promise<TimelineItem> {
    return toTimelineItem(
      await this.#itemService.copy(
        this.#ownerId,
        this.#tripId,
        itemId,
        targetDayId,
      ),
    );
  }

  reorder(request: ReorderRequest): Promise<ReorderResponse> {
    return this.#orderService.reorder(
      this.#ownerId,
      this.#tripId,
      request.tripDayId,
      {
        baseVersion: request.baseVersion,
        orderedIds: request.orderedIds,
      },
    );
  }

  async getItem(
    itemId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<CanonicalItem> {
    return this.#itemService.get(
      this.#ownerId,
      this.#tripId,
      itemId,
      options,
    );
  }

  #assertTrip(tripId: string): void {
    if (tripId !== this.#tripId) {
      throw Object.assign(new Error("Trip not found"), { status: 404 });
    }
  }
}
