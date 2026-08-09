import { expect, test } from "vitest";

import {
  ExpenseService,
  InMemoryExpenseRepository,
} from "../../src/modules/expenses/index.mjs";

test("E2E-010 lists and updates the expense attached to the edited Item", async () => {
  const repository = new InMemoryExpenseRepository({
    trips: [{ id: "trip-a", ownerId: "owner-a", defaultCurrency: "CNY" }],
    items: [{ id: "item-a", tripId: "trip-a", ownerId: "owner-a", tripDayId: "day-a" }],
  });
  const service = new ExpenseService(repository);
  const created = await service.create("owner-a", "trip-a", {
    itineraryItemId: "item-a",
    amount: "10",
    currency: "CNY",
    categoryCode: "DINING",
  });

  await expect(service.listForItem("owner-a", "trip-a", "item-a")).resolves.toEqual([created]);
  await expect(service.update("owner-a", "trip-a", created.id, {
    amount: "88", currency: "CNY", categoryCode: "TICKET",
  }, 1)).resolves.toMatchObject({
    originalAmount: "88.0000", categoryCode: "TICKET", version: 2,
  });
  await expect(service.update("owner-a", "trip-a", created.id, {
    amount: "99", currency: "CNY", categoryCode: "TICKET",
  }, 1)).rejects.toMatchObject({ code: "EXPENSE_VERSION_CONFLICT" });
});
