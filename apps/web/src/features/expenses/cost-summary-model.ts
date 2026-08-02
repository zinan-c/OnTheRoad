export type ExpenseBreakdown = {
  readonly originalTotal: string;
  readonly settledTotal: string;
  readonly unconverted: string;
};

export type CostSummary = {
  readonly settlementCurrency: string;
  readonly settledActualTotal: string;
  readonly originalCurrencyTotals: Record<string, string>;
  readonly unconverted: readonly { currency: string; amount: string }[];
  readonly breakdowns?: Record<string, Record<string, ExpenseBreakdown>>;
};

export function formatCost(value: string, currency: string): string {
  return `${value} ${currency}`;
}

export function budgetPresentation(summary: Pick<CostSummary, "settledActualTotal" | "unconverted">, budget: string | null) {
  if (budget === null) return { label: "预算未设置", tone: "neutral" as const };
  if (summary.unconverted.length > 0) return { label: `已知实际 ${formatCost(summary.settledActualTotal, "")}；仍有未折算费用`, tone: "warning" as const };
  const remaining = Number(budget) - Number(summary.settledActualTotal);
  return remaining < 0
    ? { label: `已超支 ${Math.abs(remaining).toFixed(4)}`, tone: "danger" as const }
    : { label: `暂定剩余 ${remaining.toFixed(4)}`, tone: "positive" as const };
}

export function dimensionRows(summary: CostSummary, dimension: string): Array<[string, ExpenseBreakdown]> {
  return Object.entries(summary.breakdowns?.[dimension] ?? {}).sort(([left], [right]) => left.localeCompare(right));
}
