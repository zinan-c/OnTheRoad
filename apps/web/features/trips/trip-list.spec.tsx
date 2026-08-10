// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { TripList, type TripListGateway } from "../../src/app/trips/trip-list";

afterEach(cleanup);

const deletedTrip = {
  id: "trip-8",
  name: "已确认旅行",
  startDate: "2026-10-01",
  endDate: "2026-10-03",
  totalDays: 3,
  travelers: 4,
  defaultCurrency: "EUR",
  budget: "12000.50",
  timezone: "Asia/Shanghai",
  mapProfile: "cn_primary" as const,
  description: "中英文 mixed",
  status: "deleted" as const,
  version: 3,
};

describe("E2E-008 Trip list and recycle bin", () => {
  test("keeps deleted trips out of the default list and restores the same id", async () => {
    const list = vi.fn(async (status: "active" | "deleted") => (
      status === "deleted" ? [deletedTrip] : []
    ));
    const gateway: TripListGateway = {
      list,
      restore: vi.fn().mockResolvedValue({ ...deletedTrip, status: "active", version: 4 }),
    };
    render(<TripList gateway={gateway} />);
    const user = userEvent.setup();

    expect(await screen.findByText("No trips here yet.")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Trash" }));
    expect(await screen.findByText("已确认旅行")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Restore trip" }));

    expect(gateway.restore).toHaveBeenCalledWith("trip-8", 3);
    expect((await screen.findByRole("status")).textContent).toContain("was restored");
    expect(list).toHaveBeenCalledWith("active");
  });
});
