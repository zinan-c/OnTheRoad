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
    void refresh().catch(() => setError("费用和汇率载入失败。"));
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
      setMessage(`已为“${item.target}”保存费用。`);
      event.currentTarget.reset();
    } catch {
      setError("费用保存失败。");
    }
  }

  async function saveRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fromCurrency = String(form.get("fromCurrency"));
    const toCurrency = String(form.get("toCurrency"));
    if (fromCurrency === toCurrency) {
      setError("汇率的原币和目标币种不能相同。");
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
      setMessage(`已保存 ${saved.fromCurrency}→${saved.toCurrency} 汇率；补齐 ${saved.reconciledExpenseIds?.length ?? 0} 条未折算费用。`);
    } catch {
      setError("汇率保存失败；汇率必须大于 0 且币种不能相同。");
    }
  }

  const settlementCurrency = summary?.settlementCurrency ?? "CNY";
  return <section aria-label="费用工作台" className="workspaceCard expenseWorkspace">
    <header><h2>费用统计</h2><p>原金额、汇率快照和五维汇总均来自真实 API。</p></header>
    {summary ? <CostSummaryPanel summary={summary} budget={budget} /> : <p>正在载入费用…</p>}
    {error ? <p role="alert" className="formError">{error}</p> : null}
    {message ? <p role="status" className="statusReady">{message}</p> : null}
    <form aria-label="新增费用" onSubmit={addExpense} className="expenseForm">
      <select aria-label="费用归属 Item" value={selectedItemId} onChange={(event) => setSelectedItemId(event.currentTarget.value)} required>
        {items.map((item) => <option key={item.id} value={item.id}>{item.dayNumber ? `Day ${item.dayNumber} · ` : ""}{item.target}</option>)}
      </select>
      <select aria-label="费用归属目的地" value={selectedDestinationId} onChange={(event) => setSelectedDestinationId(event.currentTarget.value)} required>
        {destinations.map((destination) => <option key={destination.id} value={destination.id}>{destination.name}</option>)}
      </select>
      <input name="amount" aria-label="金额" placeholder="金额" required />
      <select name="currency" aria-label="币种" defaultValue="CNY">{referenceData.currencies.map(({ code, label }) => <option key={code} value={code}>{code} · {label}</option>)}</select>
      <select name="category" aria-label="费用类别" defaultValue="DINING">{referenceData.costCategories.map(({ code, label }) => <option key={code} value={code}>{code} · {label}</option>)}</select>
      <button type="submit" disabled={!selectedItemId || !selectedDestinationId}>添加费用</button>
    </form>
    <form aria-label="汇率管理" onSubmit={saveRate} className="exchangeRateForm">
      <h3>手工汇率</h3>
      <select name="fromCurrency" aria-label="原币种" defaultValue="USD">{referenceData.currencies.map(({ code, label }) => <option key={code} value={code}>{code} · {label}</option>)}</select>
      <input type="hidden" name="toCurrency" value={settlementCurrency} />
      <select aria-label="目标币种" value={settlementCurrency} disabled>{referenceData.currencies.map(({ code, label }) => <option key={code} value={code}>{code} · {label}</option>)}</select>
      <input name="rate" aria-label="汇率" inputMode="decimal" required placeholder="例如 7.2000" />
      <button type="submit">保存汇率</button>
      <ul aria-label="已保存汇率">{rates.map((rate) => <li key={`${rate.fromCurrency}:${rate.toCurrency}`}>{rate.fromCurrency}→{rate.toCurrency}：{rate.rate}（v{rate.version}）</li>)}</ul>
    </form>
    <div className="previewTableScroll">
      <table aria-label="费用明细"><thead><tr><th>Item</th><th>原金额</th><th>类别</th><th>汇率快照</th><th>折算金额</th><th>版本</th></tr></thead><tbody>
        {expenses.map((expense) => <tr key={expense.id}>
          <td>{items.find(({ id }) => id === expense.itineraryItemId)?.target ?? "未关联"}</td>
          <td>{expense.originalAmount} {expense.currency}</td><td>{expense.categoryCode}</td>
          <td>{expense.exchangeRate ?? "未折算"}</td>
          <td>{expense.settledAmount ? `${expense.settledAmount} ${expense.settlementCurrency}` : "未折算"}</td>
          <td>{expense.version}</td>
        </tr>)}
      </tbody></table>
    </div>
  </section>;
}
