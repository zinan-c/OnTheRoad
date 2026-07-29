import { describe, expect, test } from "vitest";

import {
  InMemoryReferenceDataStore,
  normalizeCurrencyForPersistence,
  seedReferenceData,
} from "../src/seeds/reference-data.mjs";

describe("TC-B01-02 reference seed and alias constraints", () => {
  test("seed is idempotent, RMB persists as CNY, and system modes are protected", () => {
    const store = new InMemoryReferenceDataStore();

    const first = seedReferenceData(store);
    const second = seedReferenceData(store);

    expect(first).toEqual({ currencies: 15, costCategories: 9, transportModes: 22 });
    expect(second).toEqual(first);
    expect(store.snapshot().transportModes).toHaveLength(22);
    expect(normalizeCurrencyForPersistence("RMB")).toBe("CNY");
    expect(store.persistCurrency("RMB")).toBe("CNY");
    expect(() => store.deleteTransportMode("WALK")).toThrow(/system transport mode/i);
  });
});
