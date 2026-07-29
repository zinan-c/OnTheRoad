import {
  costCategories,
  currencies,
  normalizeCurrencyCode,
  transportModes,
} from "../../../config/src/reference-data.mjs";

export function normalizeCurrencyForPersistence(input) {
  return normalizeCurrencyCode(input);
}

export class InMemoryReferenceDataStore {
  #currencies = new Map();
  #costCategories = new Map();
  #transportModes = new Map();

  upsertCurrency(currency) {
    this.#currencies.set(currency.code, structuredClone(currency));
  }

  upsertCostCategory(category) {
    this.#costCategories.set(category.code, structuredClone(category));
  }

  upsertTransportMode(mode) {
    this.#transportModes.set(mode.code, { ...structuredClone(mode), system: true });
  }

  persistCurrency(input) {
    const code = normalizeCurrencyForPersistence(input);
    if (!this.#currencies.has(code)) throw new RangeError(`Currency is not seeded: ${code}`);
    return code;
  }

  deleteTransportMode(code) {
    const mode = this.#transportModes.get(code);
    if (mode?.system) throw new Error(`System transport mode cannot be deleted: ${code}`);
    return this.#transportModes.delete(code);
  }

  snapshot() {
    const byCode = (left, right) => left.code.localeCompare(right.code);
    return {
      currencies: [...this.#currencies.values()].sort(byCode),
      costCategories: [...this.#costCategories.values()].sort(byCode),
      transportModes: [...this.#transportModes.values()].sort(byCode),
    };
  }
}

export function seedReferenceData(store) {
  for (const currency of currencies) store.upsertCurrency(currency);
  for (const category of costCategories) store.upsertCostCategory(category);
  for (const mode of transportModes) store.upsertTransportMode(mode);
  return {
    currencies: currencies.length,
    costCategories: costCategories.length,
    transportModes: transportModes.length,
  };
}
