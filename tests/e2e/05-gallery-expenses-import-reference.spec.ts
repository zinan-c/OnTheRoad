import { expect, test, type Locator } from "@playwright/test";

import { caseName, createSimpleItem, createTrip, openNewItem } from "./helpers";

const CURRENCIES = [
  "CNY", "USD", "EUR", "JPY", "KRW", "PHP", "THB", "SGD",
  "MYR", "VND", "IDR", "HKD", "TWD", "AUD", "GBP",
] as const;

test("E2E-018 — gallery and upload product entry is temporarily hidden", async ({ page }) => {
  await createTrip(page, { name: caseName("E2E-018", "gallery-hidden") });
  await expect(page.getByRole("region", { name: /gallery|image workspace/u })).toHaveCount(0);
  await expect(page.getByLabel(/upload image/i)).toHaveCount(0);
});

test("E2E-019 — multi-currency expense and summary reconciliation", async ({ page }) => {
  await createTrip(page, {
    name: caseName("E2E-019", "expense-reconciliation"),
    startDate: "2026-10-01",
    endDate: "2026-10-04",
    destinations: "Shanghai, Zhoushan",
  });
  await createSimpleItem(page, "Dining", { kind: "dining", day: 1, mode: "WALK", expense: { amount: "200.00", currency: "CNY", remark: "Dinner" } });
  await createSimpleItem(page, "Transport", { kind: "activity", day: 2, mode: "METRO", expense: { amount: "50.25", currency: "USD", remark: "Ferry transfer" } });
  await createSimpleItem(page, "Attraction", { kind: "attraction", day: 3, mode: "FERRY", expense: { amount: "8000", currency: "JPY", remark: "Museum tickets" } });
  await createSimpleItem(page, "Other", { kind: "other", day: 4, mode: "PUBLIC_BUS", expense: { amount: "100000", currency: "VND", remark: "Trip supplies" } });

  const expenses = page.getByRole("region", { name: "Expense workspace" });
  await expect(expenses.getByRole("form", { name: "Add expense" })).toHaveCount(0);
  const summary = page.getByRole("region", { name: "Expense summary" });
  await expect(summary.getByRole("alert")).toContainText("3 expenses are missing exchange rates");

  await saveRate(expenses, "USD", "7.2000");
  await saveRate(expenses, "JPY", "0.0480");
  await saveRate(expenses, "VND", "0.00030");
  await expect(summary).toContainText("975.8000 CNY");
  await expect(summary.getByRole("alert")).toHaveCount(0);
  await summary.locator("#expense-day-2").click();
  const details = summary.getByRole("table", { name: "Daily expense details" });
  await expect(details).toContainText("50.2500 USD");
  await expect(details).toContainText("Ferry transfer");
  await expect(details).toContainText("7.2000");
  await page.reload();
  await expect(page.getByRole("region", { name: "Expense summary" })).toContainText("975.8000 CNY");
});

test("E2E-020 — import product entry is temporarily hidden", async ({ page }) => {
  await createTrip(page, { name: caseName("E2E-020", "import-hidden") });
  await expect(page.getByRole("region", { name: /import/i })).toHaveCount(0);
  await expect(page.getByLabel(/upload itinerary file/i)).toHaveCount(0);
});

test("E2E-021 — shared currency Reference Data remains available in active product surfaces", async ({ page }) => {
  await page.goto("/trips/new");
  const tripCurrency = page.getByLabel("Default currency");
  await expect(tripCurrency.locator("option")).toHaveCount(CURRENCIES.length);
  await expect(tripCurrency.locator("option").allTextContents()).resolves.toEqual([...CURRENCIES]);

  await createTrip(page, { name: caseName("E2E-021", "reference-data") });
  const itemEditor = await openNewItem(page, "other");
  const expenseCurrency = itemEditor.locator("#item-expense-currency");
  await expect(expenseCurrency.locator("option").allTextContents()).resolves.toEqual([...CURRENCIES]);
  await itemEditor.getByRole("button", { name: "Cancel" }).first().click();
  const expenseWorkspace = page.getByRole("region", { name: "Expense workspace" });
  await expect(expenseWorkspace.getByLabel("Source currency").locator("option").allTextContents()).resolves.toEqual([...CURRENCIES]);
  await expect(expenseWorkspace.getByLabel("Settlement currency").locator("option").allTextContents()).resolves.toEqual([...CURRENCIES]);
});

async function saveRate(workspace: Locator, currency: string, rate: string) {
  const form = workspace.getByRole("form", { name: "Exchange rate management" });
  await form.getByLabel("Source currency").selectOption(currency);
  await form.getByLabel("Exchange rate", { exact: true }).fill(rate);
  await form.getByRole("button", { name: "Save rate" }).click();
  await expect(workspace.getByRole("status")).toContainText(`${currency}→CNY saved`);
}
