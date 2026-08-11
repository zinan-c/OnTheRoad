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
      if (url.endsWith("/trips/trip-19")) return Response.json({ destinations: [{ id: "dest-a", name: "上海" }, { id: "dest-b", name: "舟山" }] });
      if (url.endsWith("/expenses/summary")) return Response.json(summary);
      if (url.endsWith("/exchange-rates") && method === "GET") return Response.json([]);
      if (url.endsWith("/exchange-rates") && method === "PUT") return Response.json({ fromCurrency: "USD", toCurrency: "CNY", rate: "7.200000000000", version: 1, reconciledExpenseIds: [] });
      if (url.includes("/itinerary-items/") && url.endsWith("/expenses")) return Response.json([]);
      if (url.endsWith("/expenses") && method === "POST") return Response.json({ id: "expense-1" }, { status: 201 });
      return Response.json({});
    }));
    render(<ExpenseWorkspace tripId="trip-19" items={[
      { id: "item-dining", target: "晚餐", dayNumber: 1, transportModeCode: null },
      { id: "item-transport", target: "地铁", dayNumber: 2, transportModeCode: "METRO" },
    ]} />);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText("0.0000 CNY")).toBeTruthy());

    await user.selectOptions(screen.getByLabelText("Expense item"), "item-transport");
    await user.selectOptions(screen.getByLabelText("Expense destination"), "dest-b");
    await user.type(screen.getByLabelText("Amount"), "50.25");
    await user.selectOptions(screen.getByLabelText("Currency"), "USD");
    await user.type(screen.getByLabelText("Expense notes"), "Airport transfer");
    await user.click(screen.getByRole("button", { name: "Add expense" }));
    await waitFor(() => expect(writes.some(({ body }) => body.itineraryItemId === "item-transport"
      && body.destinationId === "dest-b" && body.transportModeCode === "METRO"
      && body.remark === "Airport transfer" && body.categoryCode === undefined)).toBe(true));

    await user.selectOptions(screen.getByLabelText("Source currency"), "USD");
    await user.type(screen.getByLabelText("Exchange rate"), "7.2000");
    await user.click(screen.getByRole("button", { name: "Save rate" }));
    await waitFor(() => expect(writes.some(({ body }) => body.fromCurrency === "USD"
      && body.toCurrency === "CNY" && body.rate === "7.2000")).toBe(true));
  });
});
