// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  TripSettings,
  type TripDateSettingsGateway,
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
      version: 2,
    };
    const changeDates = vi.fn().mockResolvedValue({
      trip: { ...trip, endDate: "2026-10-05", totalDays: 5, version: 3 },
      createdDayIds: ["day-4", "day-5"],
      archivedDayIds: [],
    });
    const gateway: TripDateSettingsGateway = {
      listDays: vi.fn().mockResolvedValue([
        { id: "day-1", dayNumber: 1, date: "2026-10-01" },
        { id: "day-2", dayNumber: 2, date: "2026-10-02" },
        { id: "day-3", dayNumber: 3, date: "2026-10-03" },
      ]),
      changeDates,
    };
    const onTripChange = vi.fn();
    render(<TripSettings trip={trip} gateway={gateway} onTripChange={onTripChange} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "打开旅行设置" }));
    const endDate = screen.getByLabelText("结束日期");
    await user.clear(endDate);
    await user.type(endDate, "2026-10-05");
    await user.click(screen.getByRole("button", { name: "预览日期变更" }));

    expect(screen.getByText("新增 Day：2026-10-04、2026-10-05")).toBeTruthy();
    expect(screen.getByText("保留 Day：3")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "确认应用日期变更" }));

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
});
