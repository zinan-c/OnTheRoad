"use client";

import { budgetPresentation, dimensionRows, formatCost, type CostSummary } from "./cost-summary-model";

export function CostSummaryPanel({ summary, budget }: { readonly summary: CostSummary; readonly budget: string | null }) {
  const budgetState = budgetPresentation(summary, budget);
  return <section aria-label="费用统计" className="costSummary">
    <header><p>已知实际</p><strong>{formatCost(summary.settledActualTotal, summary.settlementCurrency)}</strong><p data-tone={budgetState.tone}>{budgetState.label}</p></header>
    {summary.unconverted.length > 0 ? <p role="alert">有 {summary.unconverted.length} 笔费用缺少汇率，未计入结算总额。</p> : null}
    <div className="costDimensions">{["day", "destination", "category", "mode", "currency"].map((dimension) => <section key={dimension} aria-label={`${dimension} 统计`}><h3>{dimension}</h3><ul>{dimensionRows(summary, dimension).map(([key, row]) => <li key={key}><span>{key}</span><span>{row.originalTotal} · 已折算 {row.settledTotal}</span></li>)}</ul></section>)}</div>
  </section>;
}
