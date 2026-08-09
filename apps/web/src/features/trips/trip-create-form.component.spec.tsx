// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  type CreatedTrip,
  TripCreateForm,
  type TripCreationGateway,
} from "./trip-create-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(cleanup);

describe("REVIEW-P1-04 TripCreateForm component", () => {
  test("E2E-021 exposes all currencies from shared Reference Data", () => {
    render(<TripCreateForm gateway={{ create: vi.fn() }} navigate={vi.fn()} />);
    const currency = screen.getByLabelText("默认币种") as HTMLSelectElement;
    expect([...currency.options].map(({ value }) => value)).toEqual([
      "CNY", "USD", "EUR", "JPY", "KRW", "PHP", "THB", "SGD",
      "MYR", "VND", "IDR", "HKD", "TWD", "AUD", "GBP",
    ]);
    expect(screen.getByRole("option", { name: "VND · 越南盾" })).toBeTruthy();
  });

  test("renders accessible fields and submits normalized form data once", async () => {
    let resolveCreate: ((trip: CreatedTrip) => void) | undefined;
    const create = vi.fn(
      () => new Promise<CreatedTrip>((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const gateway: TripCreationGateway = { create };
    const navigate = vi.fn();
    render(<TripCreateForm gateway={gateway} navigate={navigate} />);
    const user = userEvent.setup();

    expect(screen.getByText("将自动生成 5 天计划")).toBeTruthy();
    await user.clear(screen.getByLabelText("旅行名称"));
    await user.type(screen.getByLabelText("旅行名称"), "东海秋日");
    const submit = screen.getByRole("button", { name: "创建旅行" });
    await user.dblClick(submit);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "东海秋日",
        travelers: 2,
        destinations: [
          { name: "上海", countryCode: "CN" },
          { name: "舟山", countryCode: "CN" },
        ],
      }),
      { idempotencyKey: expect.any(String) },
    );
    expect(
      (screen.getByRole("button", { name: "正在创建…" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    const trip = {
      id: "trip-1",
      name: "东海秋日",
      startDate: "2026-10-01",
      endDate: "2026-10-05",
    };
    resolveCreate?.(trip);
    await screen.findByRole("button", { name: "创建旅行" });
    expect(navigate).toHaveBeenCalledWith(trip);
  });

  test("blocks an invalid date range and exposes API failures as an alert", async () => {
    const gateway: TripCreationGateway = {
      create: vi.fn().mockRejectedValue(new Error("offline")),
    };
    render(<TripCreateForm gateway={gateway} navigate={vi.fn()} />);
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText("结束日期"));
    await user.type(screen.getByLabelText("结束日期"), "2026-09-30");
    expect(screen.getByText("结束日期不能早于开始日期。")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "创建旅行" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await user.clear(screen.getByLabelText("结束日期"));
    await user.type(screen.getByLabelText("结束日期"), "2026-10-05");
    await user.click(screen.getByRole("button", { name: "创建旅行" }));
    expect((await screen.findByRole("alert")).textContent).toContain("创建失败");
  });

  test("reuses the client idempotency key after a lost response", async () => {
    const created = {
      id: "trip-safe-retry",
      name: "安全重试旅行",
      startDate: "2026-10-01",
      endDate: "2026-10-05",
    };
    const attempts: string[] = [];
    const gateway: TripCreationGateway = {
      async create(_input, { idempotencyKey }) {
        attempts.push(idempotencyKey);
        if (attempts.length === 1) throw new Error("response lost after commit");
        return created;
      },
    };
    const navigate = vi.fn();
    render(<TripCreateForm gateway={gateway} navigate={navigate} />);
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText("旅行名称"));
    await user.type(screen.getByLabelText("旅行名称"), "安全重试旅行");
    await user.click(screen.getByRole("button", { name: "创建旅行" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "创建旅行" }));

    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toBe(attempts[0]);
    expect(navigate).toHaveBeenCalledWith(created);
  });
});
