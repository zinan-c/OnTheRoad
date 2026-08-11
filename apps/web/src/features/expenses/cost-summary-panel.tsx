"use client";

import { useEffect, useMemo, useState } from "react";

import type { ExpenseDay, ExpenseItem } from "./expense-workspace";
import { budgetPresentation, dimensionRows, formatCost, type CostSummary } from "./cost-summary-model";

type ExpenseDetail = {
  readonly id: string;
  readonly itineraryItemId: string | null;
  readonly originalAmount: string;
  readonly currency: string;
  readonly remark: string | null;
  readonly settledAmount: string | null;
  readonly exchangeRate: string | null;
};

export function CostSummaryPanel({
  summary,
  budget,
  days,
  items,
  expenses,
}: {
  readonly summary: CostSummary;
  readonly budget: string | null;
  readonly days: readonly ExpenseDay[];
  readonly items: readonly ExpenseItem[];
  readonly expenses: readonly ExpenseDetail[];
}) {
  const budgetState = budgetPresentation(summary, budget);
  const [selectedDayId, setSelectedDayId] = useState(days[0]?.id ?? "");
  useEffect(() => {
    if (!days.some(({ id }) => id === selectedDayId)) setSelectedDayId(days[0]?.id ?? "");
  }, [days, selectedDayId]);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const dailyRows = days.map((day) => ({
    ...day,
    settledTotal: summary.breakdowns?.day?.[day.id]?.settledTotal ?? "0.0000",
    unconverted: summary.breakdowns?.day?.[day.id]?.unconverted ?? "0",
  }));
  const maxTotal = Math.max(0, ...dailyRows.map(({ settledTotal }) => Number(settledTotal)));
  const selectedDay = days.find(({ id }) => id === selectedDayId);
  const selectedExpenses = expenses.filter((expense) => {
    if (!expense.itineraryItemId) return false;
    return itemById.get(expense.itineraryItemId)?.tripDayId === selectedDayId;
  });

  return <section aria-label="Expense summary" className="costSummary">
    <header><p>Known actual in CNY</p><strong>{formatCost(summary.settledActualTotal, "CNY")}</strong><p data-tone={budgetState.tone}>{budgetState.label}</p></header>
    {summary.unconverted.length > 0 ? <p role="alert">{summary.unconverted.length} expenses are missing exchange rates and are excluded from the CNY total.</p> : null}
    <div className="dailyExpenseReport">
      <nav aria-label="Daily expense tree" className="dailyExpenseTree">
        {dailyRows.map((day) => <button
          id={`expense-day-${day.dayNumber}`}
          key={day.id}
          type="button"
          aria-pressed={day.id === selectedDayId}
          onClick={() => setSelectedDayId(day.id)}
        >
          <span>Day {day.dayNumber}</span>
          <span className="dailyExpenseBarTrack" aria-hidden="true"><span style={{ width: maxTotal > 0 && Number(day.settledTotal) > 0 ? `${Math.max(3, Number(day.settledTotal) / maxTotal * 100)}%` : "0%" }} /></span>
          <strong>{day.settledTotal} CNY</strong>
          {day.unconverted !== "0" ? <small>{day.unconverted} unconverted</small> : null}
        </button>)}
      </nav>
      <section aria-label="Selected day expense details" className="dailyExpenseDetails">
        <h3>{selectedDay ? `Day ${selectedDay.dayNumber} details` : "Daily details"}</h3>
        {selectedExpenses.length === 0 ? <p>No expenses recorded for this day.</p> : <div className="previewTableScroll"><table aria-label="Daily expense details"><thead><tr><th>Item</th><th>Original amount</th><th>Notes</th><th>Rate to CNY</th><th>Amount in CNY</th></tr></thead><tbody>
          {selectedExpenses.map((expense) => <tr key={expense.id}>
            <td>{expense.itineraryItemId ? itemById.get(expense.itineraryItemId)?.target ?? "Unlinked" : "Unlinked"}</td>
            <td>{expense.originalAmount} {expense.currency}</td>
            <td>{expense.remark || "—"}</td>
            <td>{expense.exchangeRate ?? "Unconverted"}</td>
            <td>{expense.settledAmount ? `${expense.settledAmount} CNY` : "Unconverted"}</td>
          </tr>)}
        </tbody></table></div>}
      </section>
    </div>
    <details className="expenseDimensions"><summary>Additional breakdowns</summary><div className="costDimensions">{["destination", "mode", "currency"].map((dimension) => <section key={dimension} aria-label={`${dimension} summary`}><h3>{dimension}</h3><ul>{dimensionRows(summary, dimension).map(([key, row]) => <li key={key}><span>{key}</span><span>{row.originalTotal} · {row.settledTotal} CNY</span></li>)}</ul></section>)}</div></details>
  </section>;
}
