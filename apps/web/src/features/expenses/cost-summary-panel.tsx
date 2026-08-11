"use client";

import { budgetPresentation, dimensionRows, formatCost, type CostSummary } from "./cost-summary-model";

export function CostSummaryPanel({ summary, budget }: { readonly summary: CostSummary; readonly budget: string | null }) {
  const budgetState = budgetPresentation(summary, budget);
  return <section aria-label="Expense summary" className="costSummary">
    <header><p>Known actual</p><strong>{formatCost(summary.settledActualTotal, summary.settlementCurrency)}</strong><p data-tone={budgetState.tone}>{budgetState.label}</p></header>
    {summary.unconverted.length > 0 ? <p role="alert">{summary.unconverted.length} expenses are missing exchange rates and are excluded from the settled total.</p> : null}
    <div className="costDimensions">{["day", "destination", "mode", "currency"].map((dimension) => <section key={dimension} aria-label={`${dimension} summary`}><h3>{dimension}</h3><ul>{dimensionRows(summary, dimension).map(([key, row]) => <li key={key}><span>{key}</span><span>{row.originalTotal} · settled {row.settledTotal}</span></li>)}</ul></section>)}</div>
  </section>;
}
