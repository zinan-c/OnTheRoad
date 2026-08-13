type RowStatus = "new" | "update" | "duplicate" | "ready" | "imported";

export type FakeImportRow = {
  id: string;
  source_row_key: string;
  normalized_data: Record<string, unknown>;
  fingerprint: string;
  status: RowStatus;
  decision_scope?: string;
  override_decision_id?: string | null;
  override_reason?: string | null;
  staged_location?: Record<string, unknown> | null;
};

export type FakeImportJob = {
  id: string;
  trip_id: string;
  owner_id: string;
  source_sha256: string;
  importer_version: string;
  mapping_hash: string;
  status: string;
  committed_rows: number;
  imported_rows?: number;
  error_rows: number;
  default_currency: string;
  mapping?: Record<string, unknown>;
  source_attachment_id?: string;
  source_sha256_bytes?: string;
  importer_type?: string;
  mapping_version?: number;
  total_rows?: number;
  valid_rows?: number;
};

type Claim = {
  jobId: string;
  rowId: string;
  itineraryItemId: string | null;
};

type LedgerEntry = {
  action: "insert" | "update" | "skip";
  itineraryItemId: string | null;
};

type FakeItem = {
  id: string;
  target: string | null;
  externalSource: string | null;
  externalId: string | null;
  version: number;
  locationId?: string | null;
};

type FakeLocation = {
  id: string;
  inputText: string;
  name: string;
  point: { latitude: number; longitude: number } | null;
  status: "unresolved" | "resolved";
};

export class FakeCommitDatabase {
  readonly queries: string[] = [];
  readonly jobs = new Map<string, FakeImportJob>();
  readonly claims = new Map<string, Claim>();
  readonly ledger = new Map<string, LedgerEntry>();
  readonly items = new Map<string, FakeItem>();
  readonly locations = new Map<string, FakeLocation>();
  readonly expenses: Array<{ itemId: string; amount: number }> = [];
  readonly queue: Array<{ name: string; payload: Record<string, unknown> }> = [];
  readonly routeGenerations = new Map<string, number>([["day-1", 1]]);
  readonly #rows = new Map<string, FakeImportRow[]>();
  readonly #raceParticipants: number;
  #claimArrivals = 0;
  #releaseRace!: () => void;
  readonly #raceReleased: Promise<void>;
  readonly #claimReady = new Map<string, Promise<void>>();
  readonly #claimReadyResolve = new Map<string, () => void>();
  #nextItem = 1;

  constructor(
    jobs: readonly FakeImportJob[],
    rows: Readonly<Record<string, readonly FakeImportRow[]>>,
    options: { raceParticipants?: number } = {},
  ) {
    for (const job of jobs) this.jobs.set(job.id, structuredClone(job));
    for (const [jobId, value] of Object.entries(rows)) this.#rows.set(jobId, value.map((row) => structuredClone(row)));
    this.#raceParticipants = options.raceParticipants ?? 1;
    this.#raceReleased = new Promise((resolve) => { this.#releaseRace = resolve; });
    for (const rowSet of this.#rows.values()) {
      for (const row of rowSet) this.#ensureClaimReady(this.claimKey("seed", row.fingerprint, row.decision_scope ?? "default"));
    }
  }

  async query<T = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number }> {
    const sql = text.replace(/\s+/gu, " ").trim();
    this.queries.push(sql);

    if (sql.startsWith("SELECT j.id, j.trip_id, j.owner_id")) {
      const job = this.job(String(values[0]));
      return result(job ? [job as unknown as T] : []);
    }
    if (sql.startsWith("SELECT count(*)::text AS count FROM import_media_task")) return result([{ count: "0" } as T]);
    if (sql.startsWith("SELECT id, source_row_key, normalized_data")) {
      const jobId = String(values[0]);
      const rows = (this.#rows.get(jobId) ?? []).filter((row) => ["new", "update", "duplicate", "ready"].includes(row.status));
      return result(rows.slice(0, Number(values[2] ?? 50)) as unknown as T[]);
    }
    if (sql.startsWith("SELECT action, itinerary_item_id FROM import_commit_ledger")) {
      const entry = this.ledger.get(this.replayKey(values, "select"));
      return result(entry ? [{ action: entry.action, itinerary_item_id: entry.itineraryItemId } as T] : []);
    }
    if (sql.startsWith("INSERT INTO import_fingerprint_claim") && sql.includes("RETURNING itinerary_item_id")) {
      const fingerprint = String(values[2]);
      const updateClaim = sql.includes("VALUES ($1::uuid, $2, $3, 'trip'");
      const scope = updateClaim ? "trip" : String(values[3]);
      const key = this.claimKey(String(values[0]), fingerprint, scope);
      await this.arriveAtRaceBarrier();
      const existing = this.findClaim(fingerprint, scope);
      if (existing) return result([]);
      this.claims.set(key, {
        jobId: updateClaim ? String(values[3]) : String(values[4]),
        rowId: updateClaim ? String(values[4]) : String(values[5]),
        itineraryItemId: updateClaim ? String(values[5]) : null,
      });
      this.#ensureClaimReady(key);
      return result([{ itinerary_item_id: updateClaim ? String(values[5]) : null } as T]);
    }
    if (sql.startsWith("SELECT itinerary_item_id FROM import_fingerprint_claim")) {
      const fingerprint = String(values[1]);
      const scope = String(values[2] ?? "trip");
      const claim = this.findClaim(fingerprint, scope);
      if (claim?.itineraryItemId === null) await this.waitForClaimItem(fingerprint, scope);
      const refreshed = this.findClaim(fingerprint, scope);
      return result(refreshed ? [{ itinerary_item_id: refreshed.itineraryItemId } as T] : []);
    }
    if (sql.startsWith("INSERT INTO import_fingerprint_claim") && sql.includes("'trip'") && !sql.includes("RETURNING")) {
      const fingerprint = String(values[2]);
      const key = this.claimKey(String(values[0]), fingerprint, "trip");
      if (!this.findClaim(fingerprint, "trip")) {
        this.claims.set(key, { jobId: String(values[3]), rowId: String(values[4]), itineraryItemId: null });
        this.#ensureClaimReady(key);
      }
      return result();
    }
    if (sql.startsWith("SELECT id FROM trip_day")) return result([{ id: "day-1" } as T]);
    if (sql.startsWith("SELECT create_location")) {
      const input = JSON.parse(String(values[0])) as Record<string, unknown>;
      const id = `location-${this.locations.size + 1}`;
      const point = input.point && typeof input.point === "object" && !Array.isArray(input.point)
        ? input.point as { latitude?: unknown; longitude?: unknown }
        : null;
      this.locations.set(id, {
        id,
        inputText: String(input.inputText ?? ""),
        name: String(input.name ?? input.inputText ?? ""),
        point: point && typeof point.latitude === "number" && typeof point.longitude === "number"
          ? { latitude: point.latitude, longitude: point.longitude }
          : null,
        status: "unresolved",
      });
      return result([{ id } as T]);
    }
    if (sql.startsWith("SELECT transition_location")) {
      const location = this.locations.get(String(values[1]));
      if (location) {
        const payload = JSON.parse(String(values[2])) as { point?: { latitude?: unknown; longitude?: unknown } };
        const point = payload.point;
        location.status = "resolved";
        location.point = point && typeof point.latitude === "number" && typeof point.longitude === "number"
          ? { latitude: point.latitude, longitude: point.longitude }
          : location.point;
      }
      return result();
    }
    if (sql.startsWith("SELECT id, version FROM itinerary_item")) {
      const source = String(values[2]);
      const id = String(values[3]);
      const item = [...this.items.values()].find((entry) => entry.externalSource === source && entry.externalId === id);
      return result(item ? [{ id: item.id, version: item.version } as T] : []);
    }
    if (sql.startsWith("SELECT create_itinerary_item")) {
      const input = JSON.parse(String(values[2])) as Record<string, unknown>;
      const id = `item-${this.#nextItem++}`;
      const item: FakeItem = {
        id,
        target: typeof input.target === "string" ? input.target : null,
        externalSource: typeof input.externalSource === "string" ? input.externalSource : null,
        externalId: typeof input.externalId === "string" ? input.externalId : null,
        version: 1,
        locationId: typeof input.locationId === "string" ? input.locationId : null,
      };
      this.items.set(id, item);
      this.bumpRouteGeneration(String(input.tripDayId ?? "day-1"));
      return result([{ value: { id } } as T]);
    }
    if (sql.startsWith("SELECT itinerary_item_as_json")) {
      const item = this.items.get(String(values[0]));
      return result([{ value: item ? { target: item.target } : {} } as T]);
    }
    if (sql.startsWith("SELECT update_itinerary_item")) {
      const item = this.items.get(String(values[2]));
      const input = JSON.parse(String(values[4])) as Record<string, unknown>;
      if (item) {
        item.target = typeof input.target === "string" ? input.target : item.target;
        item.version += 1;
        this.bumpRouteGeneration("day-1");
      }
      return result([{ value: { id: item?.id } } as T]);
    }
    if (sql.startsWith("INSERT INTO expense")) {
      this.expenses.push({ itemId: String(values[3]), amount: Number(values[6]) });
      return result();
    }
    if (sql.startsWith("UPDATE import_fingerprint_claim SET itinerary_item_id")) {
      const claim = this.findClaim(String(values[2]), String(values[3]));
      if (claim) {
        claim.itineraryItemId = String(values[1]);
        this.resolveClaim(claim);
      }
      return result();
    }
    if (sql.startsWith("INSERT INTO import_commit_ledger")) {
      const key = this.replayKey(values, "insert");
      if (!this.ledger.has(key)) {
        this.ledger.set(key, {
          action: String(values[10]) as LedgerEntry["action"],
          itineraryItemId: values[4] ? String(values[4]) : null,
        });
      }
      return result();
    }
    if (sql.startsWith("UPDATE import_row SET status = 'imported', imported_item_id")) {
      const row = this.#row(String(values[0]));
      if (row) {
        row.status = "imported";
        row.imported_item_id = values[1] ? String(values[1]) : null;
      }
      return result();
    }
    if (sql.startsWith("UPDATE import_row SET status = 'imported'")) {
      const row = this.#row(String(values[0]));
      if (row) row.status = "imported";
      return result();
    }
    if (sql.startsWith("UPDATE import_media_task SET itinerary_item_id")) return result();
    if (sql.startsWith("UPDATE import_media_task SET status = 'cancelled'")) return result();
    if (sql.startsWith("UPDATE import_job SET committed_rows")) {
      const job = this.job(String(values[0]));
      if (job) {
        job.committed_rows += Number(values[1]);
        job.imported_rows = (job.imported_rows ?? 0) + Number(values[1]);
      }
      return result();
    }
    if (sql.startsWith("SELECT count(*)::text AS count FROM import_row")) {
      const count = (this.#rows.get(String(values[0])) ?? []).filter((row) => ["new", "update", "duplicate", "ready"].includes(row.status)).length;
      return result([{ count: String(count) } as T]);
    }
    if (sql.startsWith("SELECT count(*) FILTER")) return result([{ pending: "0", failed: "0" } as T]);
    if (sql.startsWith("UPDATE import_job SET status = 'cancelled'")) {
      const job = this.job(String(values[0]));
      if (job) job.status = "cancelled";
      return result();
    }
    if (sql.startsWith("UPDATE import_job SET status = $2")) {
      const job = this.job(String(values[0]));
      if (job) job.status = String(values[1]);
      return result();
    }
    if (sql.startsWith("SELECT id FROM import_job WHERE status IN")) {
      return result([...this.jobs.values()]
        .filter((job) => ["ready_to_import", "importing"].includes(job.status))
        .map((job) => ({ id: job.id }) as T));
    }
    if (sql.startsWith("SELECT id, status, EXISTS")) {
      const job = this.job(String(values[0]));
      return result(job ? [{ id: job.id, status: job.status, has_active_media: false } as T] : []);
    }
    if (sql.startsWith("UPDATE import_job SET status = CASE WHEN $3::boolean")) {
      const job = this.job(String(values[0]));
      if (job) job.status = Boolean(values[2]) ? "cancelling" : "cancelled";
      return result();
    }
    if (sql.startsWith("UPDATE import_media_task SET status = CASE")) return result();
    if (sql.startsWith("SELECT * FROM import_job")) {
      const job = this.job(String(values[0]));
      return result(job ? [job as unknown as T] : []);
    }
    if (sql.startsWith("INSERT INTO import_job")) {
      const source = this.job(String(values[3]));
      const id = String(values[0]);
      const resumed = source ? {
        ...source,
        id,
        status: "importing",
        committed_rows: 0,
        imported_rows: 0,
      } : {
        id,
        trip_id: String(values[1]),
        owner_id: String(values[2]),
        source_sha256: "resumed",
        importer_version: "runtime-1",
        mapping_hash: "resumed",
        status: "importing",
        committed_rows: 0,
        error_rows: 0,
        default_currency: "CNY",
      };
      this.jobs.set(id, resumed);
      const sourceRows = this.#rows.get(source?.id ?? "") ?? [];
      this.#rows.set(id, sourceRows.filter((row) => !["error", "unresolved"].includes(row.status)).map((row) => ({
        ...structuredClone(row),
        id: `${row.id}:resumed`,
        status: row.status === "imported" ? "ready" : row.status,
      })));
      return result();
    }
    if (sql.startsWith("INSERT INTO import_row")) return result();
    if (sql.startsWith("INSERT INTO import_media_task")) return result();
    throw new Error(`FakeCommitDatabase does not recognize query: ${sql}`);
  }

  async json<T = unknown>(text: string, values: readonly unknown[] = []): Promise<T> {
    if (text.includes("FROM import_job j") || text.includes("FROM export_job")) {
      const job = this.job(String(values[1]));
      return (job ? {
        id: job.id,
        tripId: job.trip_id,
        ownerId: job.owner_id,
        status: job.status,
        stage: job.status,
        committedRows: job.committed_rows,
      } : null) as T;
    }
    return null as T;
  }

  async transaction<T>(operation: (client: { query: FakeCommitDatabase["query"] }) => Promise<T>): Promise<T> {
    return operation({ query: this.query.bind(this) });
  }

  async close(): Promise<void> {}

  seedRows(jobId: string, rows: readonly FakeImportRow[]): void {
    this.#rows.set(jobId, rows.map((row) => structuredClone(row)));
  }

  private job(id: string): FakeImportJob | undefined { return this.jobs.get(id); }

  private bumpRouteGeneration(dayId: string): void {
    const next = (this.routeGenerations.get(dayId) ?? 0) + 1;
    this.routeGenerations.set(dayId, next);
    this.queue.push({
      name: "route.rebuild.requested",
      payload: { dayId, routeGeneration: next },
    });
  }

  #row(id: string): FakeImportRow & { imported_item_id?: string | null } | undefined {
    for (const rows of this.#rows.values()) {
      const row = rows.find((candidate) => candidate.id === id);
      if (row) return row as FakeImportRow & { imported_item_id?: string | null };
    }
    return undefined;
  }

  private replayKey(values: readonly unknown[], shape: "select" | "insert"): string {
    return shape === "select"
      ? [values[0], values[1], values[2], values[3], values[4], values[5] ?? "default"].join("\u0000")
      : [values[0], values[5], values[6], values[7], values[8], values[11] ?? "default"].join("\u0000");
  }

  private claimKey(tripId: string, fingerprint: string, scope: string): string {
    return `${tripId}\u0000${fingerprint}\u0000${scope}`;
  }

  private findClaim(fingerprint: string, scope: string): Claim | undefined {
    return [...this.claims.entries()].find(([key]) => key.endsWith(`\u0000${fingerprint}\u0000${scope}`))?.[1];
  }

  #ensureClaimReady(key: string): void {
    if (this.#claimReady.has(key)) return;
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    this.#claimReady.set(key, promise);
    this.#claimReadyResolve.set(key, resolve);
  }

  private async waitForClaimItem(fingerprint: string, scope: string): Promise<void> {
    const entry = [...this.claims.entries()].find(([key]) => key.endsWith(`\u0000${fingerprint}\u0000${scope}`));
    if (!entry || entry[1].itineraryItemId !== null) return;
    await this.#claimReady.get(entry[0]);
  }

  private resolveClaim(claim: Claim): void {
    const entry = [...this.claims.entries()].find(([, value]) => value === claim && value.itineraryItemId !== null);
    if (!entry) return;
    this.#claimReadyResolve.get(entry[0])?.();
  }

  private async arriveAtRaceBarrier(): Promise<void> {
    if (this.#raceParticipants <= 1) return;
    this.#claimArrivals += 1;
    if (this.#claimArrivals >= this.#raceParticipants) this.#releaseRace();
    await this.#raceReleased;
  }
}

function result<T>(rows: T[] = []): { rows: T[]; rowCount: number } {
  return { rows, rowCount: rows.length };
}
