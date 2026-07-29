type TripRecord = {
  id: string;
  name?: string;
  totalDays?: number;
  status?: string;
  version?: number;
  [key: string]: unknown;
};

type TripsGateway = {
  createTrip?: (input: unknown, options: { idempotencyKey: string }) => Promise<TripRecord>;
  listTrips?: (filters?: Record<string, unknown>) => Promise<TripRecord[]>;
  deleteTrip?: (id: string) => Promise<TripRecord>;
  restoreTrip?: (id: string) => Promise<TripRecord>;
};

export function tripListLayout(viewportWidth: number): "compact" | "grid" {
  return viewportWidth < 768 ? "compact" : "grid";
}

export class TripsController {
  readonly state: {
    trips: TripRecord[];
    pending: boolean;
    error: string | null;
    confirmingDelete: string | null;
  } = {
    trips: [],
    pending: false,
    error: null,
    confirmingDelete: null,
  };

  readonly #gateway: TripsGateway;
  #inflight: { key: string; promise: Promise<TripRecord> } | null = null;
  #retryInput: { input: unknown; key: string } | null = null;

  constructor(gateway: TripsGateway) {
    this.#gateway = gateway;
  }

  async load(filters: Record<string, unknown> = {}): Promise<TripRecord[]> {
    const trips = await this.#gateway.listTrips?.(filters) ?? [];
    this.state.trips = trips;
    return trips;
  }

  submit(input: unknown, idempotencyKey: string): Promise<TripRecord> {
    if (this.#inflight?.key === idempotencyKey) return this.#inflight.promise;
    if (!this.#gateway.createTrip) return Promise.reject(new Error("createTrip is unavailable"));

    this.state.pending = true;
    this.state.error = null;
    this.#retryInput = { input, key: idempotencyKey };
    const promise = this.#gateway.createTrip(input, { idempotencyKey })
      .then((created) => {
        const index = this.state.trips.findIndex(({ id }) => id === created.id);
        if (index === -1) this.state.trips = [created, ...this.state.trips];
        else this.state.trips[index] = created;
        this.state.error = null;
        return created;
      })
      .catch((error: unknown) => {
        this.state.error = error instanceof Error ? error.message : "Trip request failed";
        throw error;
      })
      .finally(() => {
        this.state.pending = false;
        if (this.#inflight?.promise === promise) this.#inflight = null;
      });
    this.#inflight = { key: idempotencyKey, promise };
    return promise;
  }

  retry(): Promise<TripRecord> {
    if (!this.#retryInput) return Promise.reject(new Error("No failed submission to retry"));
    return this.submit(this.#retryInput.input, this.#retryInput.key);
  }

  requestDelete(id: string): void {
    this.state.confirmingDelete = id;
  }

  async confirmDelete(id: string): Promise<TripRecord | undefined> {
    if (this.state.confirmingDelete !== id) return undefined;
    this.state.confirmingDelete = null;
    const deleted = await this.#gateway.deleteTrip?.(id);
    if (deleted) this.#replace(deleted);
    return deleted;
  }

  async restore(id: string): Promise<TripRecord | undefined> {
    const restored = await this.#gateway.restoreTrip?.(id);
    if (restored) this.#replace(restored);
    return restored;
  }

  dayOneLocation(trip: TripRecord): string {
    if (!trip.id || (trip.totalDays ?? 0) < 1) throw new Error("Trip has no Day 1");
    return `/trips/${encodeURIComponent(trip.id)}/days/1`;
  }

  #replace(trip: TripRecord): void {
    const index = this.state.trips.findIndex(({ id }) => id === trip.id);
    if (index === -1) this.state.trips.push(trip);
    else this.state.trips[index] = trip;
  }
}
