import { describe, expect, test } from "vitest";

import { DateChangeRequiresConfirmationError } from "../../../../packages/domain/src/trip/date-range.mjs";
import { TripDateChangeService } from "../../src/modules/trips/date-change.mjs";

describe("TC-B03-02 shrink-with-content guard", () => {
  test("preview exposes all affected content and unconfirmed apply changes nothing", async () => {
    const repository = new FakeDateRepository();
    const service = new TripDateChangeService(repository);

    const preview = await service.preview("owner-1", "trip-1", {
      startDate: "2026-10-01",
      endDate: "2026-10-03",
    });
    expect(preview.removed.map(({ date }) => date)).toEqual(["2026-10-04", "2026-10-05"]);
    expect(preview.blockers).toEqual([
      { date: "2026-10-05", content: [{ type: "item", id: "item-last-day" }] },
    ]);

    await expect(service.apply("owner-1", "trip-1", {
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      expectedVersion: 1,
    })).rejects.toBeInstanceOf(DateChangeRequiresConfirmationError);
    expect(repository.applyCalls).toBe(0);
    expect(repository.dates).toEqual([
      "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05",
    ]);
  });
});

class FakeDateRepository {
  dates = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];
  applyCalls = 0;

  async loadDateContext() {
    return {
      version: 1,
      days: this.dates.map((date, index) => ({
        id: `day-${index + 1}`,
        date,
        dayNumber: index + 1,
        dayOfWeek: new Date(`${date}T00:00:00Z`).getUTCDay(),
        isWorkday: true,
      })),
      contentByDate: {
        "2026-10-05": [{ type: "item", id: "item-last-day" }],
      },
    };
  }

  async applyDateRange() {
    this.applyCalls += 1;
  }
}
