"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useReferenceData } from "../reference-data/use-reference-data";
import { CostSummaryPanel } from "./cost-summary-panel";
import type { CostSummary } from "./cost-summary-model";

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";

export type ExpenseItem = {
  readonly id: string;
  readonly target: string;
  readonly dayNumber?: number;
  readonly transportModeCode?: string | null;
};

type Destination = { readonly id: string; readonly name: string };

type Expense = {
  readonly id: string;
  readonly itineraryItemId: string | null;
  readonly originalAmount: string;
  readonly currency: string;
  readonly categoryCode: string;
  readonly settledAmount: string | null;
  readonly settlementCurrency: string;
  readonly exchangeRate: string | null;
  readonly version: number;
};

type ExchangeRate = {
  readonly fromCurrency: string;
  readonly toCurrency: string;
  readonly rate: string;
  readonly version: number;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ORIGIN}/api/v1${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { accept: "application/json", ...init?.headers },
  });
  if (!response.ok) throw new Error(`API ${response.status}: ${path}`);
  return response.json() as Promise<T>;
}

export function ExpenseWorkspace({
  tripId,
  items,
  budget = null,
}: {
  readonly tripId: string;
  readonly items: readonly ExpenseItem[];
  readonly budget?: string | null;
}) {
  const referenceData = useReferenceData();
  const [summary, setSummary] = useState<CostSummary>();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [selectedItemId, setSelectedItemId] = useState(items[0]?.id ?? "");
  const [selectedDestinationId, setSelectedDestinationId] = useState("");
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  const refresh = useCallback(async () => {
    const [loadedSummary, loadedRates, loadedExpenses, trip] = await Promise.all([
      request<CostSummary>(`/trips/${tripId}/expenses/summary`),
      request<ExchangeRate[]>(`/trips/${tripId}/exchange-rates`),
      Promise.all(items.map(({ id }) => request<Expense[]>(
        `/trips/${tripId}/itinerary-items/${id}/expenses`,
      ))).then((groups) => groups.flat()),
      request<{ destinations: Destination[] }>(`/trips/${tripId}`),
    ]);
    setSummary(loadedSummary);
    setRates(loadedRates);
    setExpenses(loadedExpenses);
    setDestinations(trip.destinations);
  }, [items, tripId]);

  useEffect(() => {
    if (!items.some(({ id }) => id === selectedItemId)) setSelectedItemId(items[0]?.id ?? "");
    void refresh().catch(() => setError("Unable to load expenses and exchange rates."));
  }, [items, refresh, selectedItemId]);

  useEffect(() => {
    if (!destinations.some(({ id }) => id === selectedDestinationId)) setSelectedDestinationId(destinations[0]?.id ?? "");
  }, [destinations, selectedDestinationId]);

  async function addExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const item = items.find(({ id }) => id === selectedItemId);
    if (!item) return;
    const form = new FormData(event.currentTarget);
    setError(undefined);
    try {
      await request(`/trips/${tripId}/expenses`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          itineraryItemId: item.id,
          destinationId: selectedDestinationId || null,
          transportModeCode: item.transportModeCode ?? null,
          amount: String(form.get("amount")),
          currency: String(form.get("currency")),
          categoryCode: String(form.get("category")),
        }),
      });
      await refresh();
      setMessage(`Expense saved for “${item.target}”.`);
      event.currentTarget.reset();
    } catch {
      setError("Unable to save the expense.");
    }
  }

  async function saveRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fromCurrency = String(form.get("fromCurrency"));
    const toCurrency = String(form.get("toCurrency"));
    if (fromCurrency === toCurrency) {
      setError("The source and settlement currencies must be different.");
      return;
    }
    setError(undefined);
    try {
      const saved = await request<ExchangeRate & { reconciledExpenseIds?: string[] }>(
        `/trips/${tripId}/exchange-rates`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            fromCurrency,
            toCurrency,
            rate: String(form.get("rate")),
          }),
        },
      );
      await refresh();
      setMessage(`${saved.fromCurrency}→${saved.toCurrency} saved; ${saved.reconciledExpenseIds?.length ?? 0} unconverted expenses reconciled.`);
    } catch {
      setError("Unable to save the rate. It must be greater than zero and use different currencies.");
    }
  }

  const settlementCurrency = summary?.settlementCurrency ?? "CNY";
  return <section aria-label="Expense workspace" className="workspaceCard expenseWorkspace">
    <header><h2>Expenses</h2><p>Original amounts, exchange-rate snapshots, and summaries come from the live API.</p></header>
    {summary ? <CostSummaryPanel summary={summary} budget={budget} /> : <p>Loading expenses…</p>}
    {error ? <p role="alert" className="formError">{error}</p> : null}
    {message ? <p role="status" className="statusReady">{message}</p> : null}
    <form aria-label="Add expense" onSubmit={addExpense} className="expenseForm">
      <select aria-label="Expense item" value={selectedItemId} onChange={(event) => setSelectedItemId(event.currentTarget.value)} required>
        {items.map((item) => <option key={item.id} value={item.id}>{item.dayNumber ? `Day ${item.dayNumber} · ` : ""}{item.target}</option>)}
      </select>
      <select aria-label="Expense destination" value={selectedDestinationId} onChange={(event) => setSelectedDestinationId(event.currentTarget.value)} required>
        {destinations.map((destination) => <option key={destination.id} value={destination.id}>{destination.name}</option>)}
      </select>
      <input name="amount" aria-label="Amount" placeholder="Amount" required />
      <select name="currency" aria-label="Currency" defaultValue="CNY">{referenceData.currencies.map(({ code }) => <option key={code} value={code}>{code}</option>)}</select>
      <select name="category" aria-label="Expense category" defaultValue="DINING">{referenceData.costCategories.map(({ code }) => <option key={code} value={code}>{code}</option>)}</select>
      <button type="submit" disabled={!selectedItemId || !selectedDestinationId}>Add expense</button>
    </form>
    <form aria-label="Exchange rate management" onSubmit={saveRate} className="exchangeRateForm">
      <h3>Manual exchange rate</h3>
      <select name="fromCurrency" aria-label="Source currency" defaultValue="USD">{referenceData.currencies.map(({ code }) => <option key={code} value={code}>{code}</option>)}</select>
      <input type="hidden" name="toCurrency" value={settlementCurrency} />
      <select aria-label="Settlement currency" value={settlementCurrency} disabled>{referenceData.currencies.map(({ code }) => <option key={code} value={code}>{code}</option>)}</select>
      <input name="rate" aria-label="Exchange rate" inputMode="decimal" required placeholder="For example, 7.2000" />
      <button type="submit">Save rate</button>
      <ul aria-label="Saved exchange rates">{rates.map((rate) => <li key={`${rate.fromCurrency}:${rate.toCurrency}`}>{rate.fromCurrency}→{rate.toCurrency}: {rate.rate} (v{rate.version})</li>)}</ul>
    </form>
    <div className="previewTableScroll">
      <table aria-label="Expense details"><thead><tr><th>Item</th><th>Original amount</th><th>Category</th><th>Rate snapshot</th><th>Settled amount</th><th>Version</th></tr></thead><tbody>
        {expenses.map((expense) => <tr key={expense.id}>
          <td>{items.find(({ id }) => id === expense.itineraryItemId)?.target ?? "Unlinked"}</td>
          <td>{expense.originalAmount} {expense.currency}</td><td>{expense.categoryCode}</td>
          <td>{expense.exchangeRate ?? "Unconverted"}</td>
          <td>{expense.settledAmount ? `${expense.settledAmount} ${expense.settlementCurrency}` : "Unconverted"}</td>
          <td>{expense.version}</td>
        </tr>)}
      </tbody></table>
    </div>
  </section>;
}
