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

    await user.click(screen.getByRole("button", { name: "打开旅行设置" }));
    await user.clear(screen.getByLabelText("旅行名称"));
    await user.type(screen.getByLabelText("旅行名称"), "已确认旅行");
    await user.type(screen.getByLabelText("旅行描述"), "Shanghai 与舟山 mixed description");
    await user.clear(screen.getByLabelText("同行人数"));
    await user.type(screen.getByLabelText("同行人数"), "4");
    await user.type(screen.getByLabelText("预算"), "12000.50");
    await user.selectOptions(screen.getByLabelText("默认币种"), "EUR");
    await user.click(screen.getByRole("button", { name: "保存基本设置" }));

    expect(gateway.update).toHaveBeenCalledWith("trip-8", expect.objectContaining({
      name: "已确认旅行",
      travelers: 4,
      budget: "12000.50",
      defaultCurrency: "EUR",
      timezone: "Asia/Shanghai",
      mapProfile: "cn_primary",
    }), 1);

    rerender(
      <TripSettings trip={updated} gateway={gateway} onTripChange={onTripChange} onDeleted={onDeleted} />,
    );
    await user.click(screen.getByRole("button", { name: "删除旅行" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(gateway.delete).toHaveBeenCalledWith("trip-8", 2);
    expect(onDeleted).toHaveBeenCalledWith(expect.objectContaining({ status: "deleted", version: 3 }));
  });
});
