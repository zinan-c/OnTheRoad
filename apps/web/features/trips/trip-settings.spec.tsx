// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  TripSettings,
  type TripSettingsGateway,
} from "../../src/features/trips/trip-settings";

afterEach(cleanup);

describe("E2E-007 Trip date settings", () => {
  test("previews extension and applies it with the current version", async () => {
    const trip = {
      id: "trip-7",
      name: "日期旅行",
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      totalDays: 3,
      travelers: 2,
      defaultCurrency: "CNY",
      budget: null,
      timezone: "Asia/Shanghai",
      mapProfile: "cn_primary" as const,
      description: null,
      status: "active" as const,
      version: 2,
    };
    const changeDates = vi.fn().mockResolvedValue({
      trip: { ...trip, endDate: "2026-10-05", totalDays: 5, version: 3 },
      createdDayIds: ["day-4", "day-5"],
      archivedDayIds: [],
    });
    const gateway: TripSettingsGateway = {
      listDays: vi.fn().mockResolvedValue([
        { id: "day-1", dayNumber: 1, date: "2026-10-01" },
        { id: "day-2", dayNumber: 2, date: "2026-10-02" },
        { id: "day-3", dayNumber: 3, date: "2026-10-03" },
      ]),
      changeDates,
      update: vi.fn(),
      delete: vi.fn(),
    };
    const onTripChange = vi.fn();
    render(<TripSettings trip={trip} gateway={gateway} onTripChange={onTripChange} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Edit trip" }));
    const endDate = screen.getByLabelText("End date");
    await user.clear(endDate);
    await user.type(endDate, "2026-10-05");
    await user.click(screen.getByRole("button", { name: "Preview date changes" }));

    expect(screen.getByText("Days added: 2026-10-04, 2026-10-05")).toBeTruthy();
    expect(screen.getByText("Days retained: 3")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Apply date changes" }));

    expect(changeDates).toHaveBeenCalledWith(
      "trip-7",
      { startDate: "2026-10-01", endDate: "2026-10-05" },
      2,
    );
    expect(onTripChange).toHaveBeenCalledWith(expect.objectContaining({
      totalDays: 5,
      version: 3,
    }));
  });

  test("updates every lifecycle field and confirms soft deletion", async () => {
    const trip = {
      id: "trip-8",
      name: "待修改旅行",
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      totalDays: 3,
      travelers: 2,
      defaultCurrency: "CNY",
      budget: null,
      timezone: "Asia/Shanghai",
      mapProfile: "cn_primary" as const,
      description: null,
      status: "active" as const,
      version: 1,
    };
    const updated = {
      ...trip,
      name: "已确认旅行",
      description: "Shanghai 与舟山 mixed description",
      travelers: 4,
      budget: "12000.50",
      defaultCurrency: "EUR",
      mapProfile: "international_primary" as const,
      version: 2,
    };
    const gateway: TripSettingsGateway = {
      listDays: vi.fn(),
      changeDates: vi.fn(),
      update: vi.fn().mockResolvedValue(updated),
      delete: vi.fn().mockResolvedValue({
        ...updated,
        status: "deleted",
        version: 3,
      }),
    };
    const onTripChange = vi.fn();
    const onDeleted = vi.fn();
    const { rerender } = render(
      <TripSettings trip={trip} gateway={gateway} onTripChange={onTripChange} onDeleted={onDeleted} />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Edit trip" }));
    await user.clear(screen.getByLabelText("Trip name"));
    await user.type(screen.getByLabelText("Trip name"), "已确认旅行");
    await user.type(screen.getByLabelText("Description"), "Shanghai 与舟山 mixed description");
    await user.clear(screen.getByLabelText("Travelers"));
    await user.type(screen.getByLabelText("Travelers"), "4");
    await user.type(screen.getByLabelText("Budget"), "12000.50");
    await user.selectOptions(screen.getByLabelText("Default currency"), "EUR");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(gateway.update).toHaveBeenCalledWith("trip-8", expect.objectContaining({
      name: "已确认旅行",
      travelers: 4,
      budget: "12000.50",
      defaultCurrency: "EUR",
      timezone: "Asia/Shanghai",
      mapProfile: "international_primary",
    }), 1);

    rerender(
      <TripSettings trip={updated} gateway={gateway} onTripChange={onTripChange} onDeleted={onDeleted} />,
    );
    await user.click(screen.getByRole("button", { name: "Delete trip" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(gateway.delete).toHaveBeenCalledWith("trip-8", 2);
    expect(onDeleted).toHaveBeenCalledWith(expect.objectContaining({ status: "deleted", version: 3 }));
  });
});
