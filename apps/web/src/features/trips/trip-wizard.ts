import { normalizeCurrencyCode } from "@on-the-road/config/reference-data";

type Destination = {
  name: string;
  countryCode?: string;
  city?: string;
  region?: string;
};

type WizardState = {
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  travelers?: number;
  destinations?: Destination[];
  defaultCurrency?: string;
  budget?: string;
  timezone?: string;
  mapProfile?: string;
};

const DAY_MS = 86_400_000;

function parseLocalDate(value: string | undefined, name: string): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new TypeError(`${name} must be YYYY-MM-DD`);
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) throw new TypeError(`${name} is invalid`);
  return timestamp;
}

export class TripWizard {
  readonly #state: WizardState = {};
  #step = 0;

  get step(): number {
    return this.#step;
  }

  updateBasics(input: Pick<WizardState, "name" | "description">): void {
    Object.assign(this.#state, input);
  }

  updateDates(input: Pick<WizardState, "startDate" | "endDate" | "travelers">): void {
    Object.assign(this.#state, input);
  }

  updateDestinations(destinations: Destination[]): void {
    this.#state.destinations = destinations.map((destination) => ({ ...destination }));
  }

  updateBudget(
    input: Pick<WizardState, "defaultCurrency" | "budget" | "timezone" | "mapProfile">,
  ): void {
    Object.assign(this.#state, input);
  }

  next(): number {
    this.#validateStep(this.#step);
    this.#step = Math.min(3, this.#step + 1);
    return this.#step;
  }

  back(): number {
    this.#step = Math.max(0, this.#step - 1);
    return this.#step;
  }

  handleKey(key: string): number {
    if (key === "Enter") return this.next();
    if (key === "Escape") return this.back();
    return this.#step;
  }

  summary() {
    const payload = this.submission();
    return {
      ...payload,
      dateLabel: `${payload.startDate} → ${payload.endDate}`,
      totalDays: this.#totalDays(),
      destinationLabel: payload.destinations.map(({ name }) => name).join("、"),
    };
  }

  submission() {
    for (let step = 0; step <= 3; step += 1) this.#validateStep(step);
    return {
      name: this.#state.name!,
      ...(this.#state.description ? { description: this.#state.description } : {}),
      startDate: this.#state.startDate!,
      endDate: this.#state.endDate!,
      travelers: this.#state.travelers!,
      destinations: this.#state.destinations!.map((destination) => ({ ...destination })),
      defaultCurrency: normalizeCurrencyCode(this.#state.defaultCurrency!),
      budget: this.#state.budget!,
      timezone: this.#state.timezone!,
      mapProfile: this.#state.mapProfile!,
    };
  }

  #totalDays(): number {
    const start = parseLocalDate(this.#state.startDate, "start date");
    const end = parseLocalDate(this.#state.endDate, "end date");
    if (end < start) throw new RangeError("end date must not precede start date");
    return Math.floor((end - start) / DAY_MS) + 1;
  }

  #validateStep(step: number): void {
    if (step === 0 && !this.#state.name?.trim()) {
      throw new TypeError("trip name is required");
    }
    if (step === 1) {
      this.#totalDays();
      if (
        !Number.isSafeInteger(this.#state.travelers)
        || (this.#state.travelers ?? 0) < 1
        || (this.#state.travelers ?? 0) > 999
      ) {
        throw new RangeError("travelers must be an integer from 1 to 999");
      }
    }
    if (
      step === 2
      && (!this.#state.destinations?.length
        || this.#state.destinations.some(({ name }) => !name.trim()))
    ) {
      throw new TypeError("at least one named destination is required");
    }
    if (step === 3) {
      normalizeCurrencyCode(this.#state.defaultCurrency ?? "");
      if (!this.#state.timezone || !this.#state.mapProfile) {
        throw new TypeError("timezone and map profile are required");
      }
      if (!/^\d+(?:\.\d{1,2})?$/u.test(this.#state.budget ?? "")) {
        throw new TypeError("budget must be a non-negative decimal");
      }
    }
  }
}
