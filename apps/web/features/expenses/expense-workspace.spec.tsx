// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ExpenseWorkspace } from "../../src/features/expenses/expense-workspace";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("E2E-019 expense product workspace", () => {
  test("assigns an expense to the selected Item and saves a manual rate", async () => {
    const writes: Array<{ url: string; method: string; body: any }> = [];
    const summary = {
      settlementCurrency: "CNY",
      settledActualTotal: "0.0000",
      originalCurrencyTotals: {},
      unconverted: [],
      breakdowns: {},
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method !== "GET") writes.push({ url, method, body: JSON.parse(String(init?.body)) });
      if (url.endsWith("/system/reference-data")) return new Response("{}", { status: 503 });
      if (url.endsWith("/expenses/summary")) return Response.json(summary);
      if (url.endsWith("/exchange-rates") && method === "GET") return Response.json([]);
      if (url.endsWith("/exchange-rates") && method === "PUT") return Response.json({ fromCurrency: "USD", toCurrency: "CNY", rate: "7.200000000000", version: 1, reconciledExpenseIds: [] });
      if (url.includes("/itinerary-items/") && url.endsWith("/expenses")) return Response.json([]);
      if (url.endsWith("/expenses") && method === "POST") return Response.json({ id: "expense-1" }, { status: 201 });
      return Response.json({});
    }));
    render(<ExpenseWorkspace tripId="trip-19" items={[
      { id: "item-dining", target: "晚餐", dayNumber: 1, destinationId: "dest-a", transportModeCode: null },
      { id: "item-transport", target: "地铁", dayNumber: 2, destinationId: "dest-b", transportModeCode: "METRO" },
    ]} />);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText("0.0000 CNY")).toBeTruthy());

    await user.selectOptions(screen.getByLabelText("费用归属 Item"), "item-transport");
    await user.type(screen.getByLabelText("金额"), "50.25");
    await user.selectOptions(screen.getByLabelText("币种"), "USD");
    await user.selectOptions(screen.getByLabelText("费用类别"), "TRANSPORT");
    await user.click(screen.getByRole("button", { name: "添加费用" }));
    await waitFor(() => expect(writes.some(({ body }) => body.itineraryItemId === "item-transport"
      && body.destinationId === "dest-b" && body.transportModeCode === "METRO")).toBe(true));

    await user.selectOptions(screen.getByLabelText("原币种"), "USD");
    await user.type(screen.getByLabelText("汇率"), "7.2000");
    await user.click(screen.getByRole("button", { name: "保存汇率" }));
    await waitFor(() => expect(writes.some(({ body }) => body.fromCurrency === "USD"
      && body.toCurrency === "CNY" && body.rate === "7.2000")).toBe(true));
  });
});
