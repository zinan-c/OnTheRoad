"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useReferenceData } from "../reference-data/use-reference-data";
import { CostSummaryPanel } from "./cost-summary-panel";
import type { CostSummary } from "./cost-summary-model";

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";

export type ExpenseItem = {
  readonly id: string;
  readonly target: string;
  readonly tripDayId?: string;
  readonly dayNumber?: number;
  readonly transportModeCode?: string | null;
};

export type ExpenseDay = {
  readonly id: string;
  readonly dayNumber: number;
};

type Expense = {
  readonly id: string;
  readonly itineraryItemId: string | null;
  readonly originalAmount: string;
  readonly currency: string;
  readonly categoryCode: string;
  readonly remark: string | null;
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
  days,
  items,
  budget = null,
}: {
  readonly tripId: string;
  readonly days: readonly ExpenseDay[];
  readonly items: readonly ExpenseItem[];
  readonly budget?: string | null;
}) {
  const referenceData = useReferenceData();
  const [summary, setSummary] = useState<CostSummary>();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  const refresh = useCallback(async () => {
    const [loadedSummary, loadedRates, loadedExpenses] = await Promise.all([
      request<CostSummary>(`/trips/${tripId}/expenses/summary`),
      request<ExchangeRate[]>(`/trips/${tripId}/exchange-rates`),
      Promise.all(items.map(({ id }) => request<Expense[]>(
        `/trips/${tripId}/itinerary-items/${id}/expenses`,
      ))).then((groups) => groups.flat()),
    ]);
    setSummary(loadedSummary);
    setRates(loadedRates);
    setExpenses(loadedExpenses);
  }, [items, tripId]);

  useEffect(() => {
    void refresh().catch(() => setError("Unable to load expenses and exchange rates."));
  }, [refresh]);

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

  const settlementCurrency = "CNY";
  return <section aria-label="Expense workspace" className="workspaceCard expenseWorkspace">
    <header><h2>Expense report</h2><p>Read-only totals are calculated from expenses entered on daily itinerary items.</p></header>
    {summary ? <CostSummaryPanel summary={summary} budget={budget} days={days} items={items} expenses={expenses} /> : <p>Loading expenses…</p>}
    {error ? <p role="alert" className="formError">{error}</p> : null}
    {message ? <p role="status" className="statusReady">{message}</p> : null}
    <form aria-label="Exchange rate management" onSubmit={saveRate} className="exchangeRateForm">
      <h3>Manual exchange rate</h3>
      <select name="fromCurrency" aria-label="Source currency" defaultValue="USD">{referenceData.currencies.map(({ code }) => <option key={code} value={code}>{code}</option>)}</select>
      <input type="hidden" name="toCurrency" value={settlementCurrency} />
      <select aria-label="Settlement currency" value={settlementCurrency} disabled>{referenceData.currencies.map(({ code }) => <option key={code} value={code}>{code}</option>)}</select>
      <input name="rate" aria-label="Exchange rate" inputMode="decimal" required placeholder="For example, 7.2000" />
      <button type="submit">Save rate</button>
      <ul aria-label="Saved exchange rates">{rates.map((rate) => <li key={`${rate.fromCurrency}:${rate.toCurrency}`}>{rate.fromCurrency}→{rate.toCurrency}: {rate.rate} (v{rate.version})</li>)}</ul>
    </form>
  </section>;
}
