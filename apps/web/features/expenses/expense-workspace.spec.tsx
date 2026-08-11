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
  test("shows read-only daily expense details and saves a manual rate", async () => {
    const writes: Array<{ url: string; method: string; body: any }> = [];
    const summary = {
      settlementCurrency: "CNY",
      settledActualTotal: "361.8000",
      originalCurrencyTotals: { USD: "50.2500" },
      unconverted: [],
      breakdowns: { day: { "day-2": { originalTotal: "50.2500", settledTotal: "361.8000", unconverted: "0" } } },
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method !== "GET") writes.push({ url, method, body: JSON.parse(String(init?.body)) });
      if (url.endsWith("/system/reference-data")) return new Response("{}", { status: 503 });
      if (url.endsWith("/expenses/summary")) return Response.json(summary);
      if (url.endsWith("/exchange-rates") && method === "GET") return Response.json([]);
      if (url.endsWith("/exchange-rates") && method === "PUT") return Response.json({ fromCurrency: "USD", toCurrency: "CNY", rate: "7.200000000000", version: 1, reconciledExpenseIds: [] });
      if (url.includes("item-transport/expenses")) return Response.json([{
        id: "expense-1", itineraryItemId: "item-transport", originalAmount: "50.2500",
        currency: "USD", remark: "Airport transfer", settledAmount: "361.8000",
        settlementCurrency: "CNY", exchangeRate: "7.200000000000", version: 1,
      }]);
      if (url.includes("/itinerary-items/") && url.endsWith("/expenses")) return Response.json([]);
      return Response.json({});
    }));
    render(<ExpenseWorkspace
      tripId="trip-19"
      days={[{ id: "day-1", dayNumber: 1 }, { id: "day-2", dayNumber: 2 }]}
      items={[
        { id: "item-dining", target: "Dinner", tripDayId: "day-1", dayNumber: 1, transportModeCode: null },
        { id: "item-transport", target: "Metro", tripDayId: "day-2", dayNumber: 2, transportModeCode: "METRO" },
      ]}
    />);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByText("361.8000 CNY")).toHaveLength(2));

    expect(screen.queryByRole("form", { name: "Add expense" })).toBeNull();
    expect(screen.getByText(/apply only to this itinerary/u)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Day 2/u }));
    expect(screen.getByRole("table", { name: "Daily expense details" }).textContent).toContain("Airport transfer");

    await user.selectOptions(screen.getByLabelText("Source currency"), "USD");
    await user.type(screen.getByLabelText("Exchange rate"), "7.2000");
    await user.click(screen.getByRole("button", { name: "Save rate" }));
    await waitFor(() => expect(writes.some(({ body }) => body.fromCurrency === "USD"
      && body.toCurrency === "CNY" && body.rate === "7.2000")).toBe(true));
  });
});
