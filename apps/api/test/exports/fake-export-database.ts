type FakeTrip = Record<string, unknown>;

export type FakeAttachment = {
  id: string;
  itinerary_item_id: string | null;
  import_media_task_id?: string | null;
  object_key: string;
  status: string;
  object_version: string | null;
  checksum_sha256: string | null;
  content_type: string;
  content_length: number;
  width: number | null;
  height: number | null;
  caption: string | null;
  sort_order: number;
  is_cover: boolean;
  version: number;
};

export type FakeMediaTask = {
  id: string;
  itinerary_item_id: string | null;
  attachment_id: string | null;
  source_row_key: string;
  url_ordinal: number;
  status: string;
  error_code: string | null;
};

export type FakeExportJob = {
  id: string;
  trip_id: string;
  owner_id: string;
  created_by: string;
  idempotency_key: string;
  trip_version: number;
  status: string;
  stage: string;
  options: Record<string, unknown>;
  options_hash: string;
  template_version: string;
  template_hash: string;
  snapshot_schema_version: number;
  snapshot: Record<string, unknown>;
  snapshot_hash: string;
  omission_count: number;
  warnings: unknown[];
  completed_at: string | null;
  assets: FakeExportAsset[];
};

type FakeExportAsset = {
  asset_id: string;
  kind: string;
  content_type: string;
  checksum_sha256: string | null;
  object_version: string | null;
  width: number | null;
  height: number | null;
  required: boolean;
  status: string;
  omission_reason: string | null;
};

export type FakeExportState = {
  trip: FakeTrip;
  days: Record<string, unknown>[];
  items: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
  routes: Record<string, unknown>[];
  attachments: FakeAttachment[];
  mediaTasks: FakeMediaTask[];
  destinations: Record<string, unknown>[];
  jobs: FakeExportJob[];
};

type QueryResult = { rows: Record<string, unknown>[]; rowCount?: number };

function clone<T>(value: T): T {
  return structuredClone(value);
}

function compact(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim().toLowerCase();
}

export class FakeExportDatabase {
  readonly queries: string[] = [];
  readonly state: FakeExportState;
  private transactionTail: Promise<void> = Promise.resolve();
  private readonly onSnapshotQuery?: (sql: string) => void;

  constructor(
    state: FakeExportState,
    options: { onSnapshotQuery?: (sql: string) => void } = {},
  ) {
    this.state = state;
    this.onSnapshotQuery = options.onSnapshotQuery;
  }

  async transaction<T>(operation: (client: { query: (sql: string, values?: unknown[]) => Promise<QueryResult> }) => Promise<T>): Promise<T> {
    const run = this.transactionTail.then(async () => {
      const snapshot = clone(this.state);
      const client = { query: (sql: string, values: unknown[] = []) => this.query(snapshot, sql, values) };
      return operation(client);
    });
    this.transactionTail = run.then(() => undefined, () => undefined);
    return run;
  }

  async json<T>(sql: string, values: unknown[] = []): Promise<T> {
    this.queries.push(sql);
    const text = compact(sql);
    if (text.includes("from export_job j") || text.includes("from export_job where")) {
      const id = values[1] ?? values[0];
      const job = this.state.jobs.find((entry) => entry.id === id) ?? this.state.jobs[0];
      return clone(this.asJsonJob(job)) as T;
    }
    return null as T;
  }

  private async query(snapshot: FakeExportState, sql: string, values: unknown[]): Promise<QueryResult> {
    this.queries.push(sql);
    const text = compact(sql);
    if (text.startsWith("set transaction")) return { rows: [] };
    if (text.includes("from trip_day")) return { rows: clone(snapshot.days) };
    if (text.includes("from itinerary_item")) return { rows: clone(snapshot.items) };
    if (text.includes("from expense")) return { rows: clone(snapshot.expenses) };
    if (text.includes("from route_segment")) return { rows: clone(snapshot.routes) };
    if (text.includes("from attachment")) {
      this.onSnapshotQuery?.("attachment");
      return { rows: clone(snapshot.attachments) };
    }
    if (text.includes("from import_media_task")) {
      this.onSnapshotQuery?.("import_media_task");
      return { rows: clone(snapshot.mediaTasks) };
    }
    if (text.includes("from destination")) return { rows: clone(snapshot.destinations) };
    if (text.includes("from trip ")) return { rows: [clone(snapshot.trip)] };

    if (text.includes("from export_job") && text.includes("idempotency_key")) {
      const tripId = String(values[0]);
      const ownerId = String(values[1]);
      const key = String(values[2]);
      return {
        rows: snapshot.jobs
          .filter((job) => job.trip_id === tripId && job.owner_id === ownerId && job.idempotency_key === key)
          .map((job) => ({
            id: job.id,
            status: job.status,
            options_hash: job.options_hash,
            snapshot_hash: job.snapshot_hash,
            template_version: job.template_version,
            trip_version: job.trip_version,
            created_at: "2026-08-13T00:00:00.000Z",
            updated_at: "2026-08-13T00:00:00.000Z",
            completed_at: job.completed_at,
          })),
      };
    }
    if (text.includes("from export_job") && text.includes("status in")) {
      const [tripId, ownerId, snapshotHash, templateVersion, templateHash, optionsHash] = values.map(String);
      const job = snapshot.jobs.find((entry) => entry.trip_id === tripId
        && entry.owner_id === ownerId
        && ["completed", "completed_with_warnings"].includes(entry.status)
        && entry.snapshot_hash === snapshotHash
        && entry.template_version === templateVersion
        && entry.template_hash === templateHash
        && entry.options_hash === optionsHash);
      return { rows: job ? [{ id: job.id }] : [] };
    }
    if (text.startsWith("insert into export_job (")) {
      const [id, tripId, ownerId, idempotencyKey, tripVersion, status, stage, options, optionsHash,
        templateVersion, templateHash, schemaVersion, snapshot, snapshotHash, omissionCount, warnings] = values;
      snapshotState(snapshot as string, this.state);
      this.state.jobs.push({
        id: String(id),
        trip_id: String(tripId),
        owner_id: String(ownerId),
        created_by: String(ownerId),
        idempotency_key: String(idempotencyKey),
        trip_version: Number(tripVersion),
        status: String(status),
        stage: String(stage),
        options: JSON.parse(String(options)) as Record<string, unknown>,
        options_hash: String(optionsHash),
        template_version: String(templateVersion),
        template_hash: String(templateHash),
        snapshot_schema_version: Number(schemaVersion),
        snapshot: JSON.parse(String(snapshot)) as Record<string, unknown>,
        snapshot_hash: String(snapshotHash),
        omission_count: Number(omissionCount),
        warnings: JSON.parse(String(warnings)) as unknown[],
        completed_at: null,
        assets: [],
      });
      return { rows: [] };
    }
    if (text.startsWith("insert into export_job_asset (")) {
      const [jobId, assetId, kind, contentType, checksum, objectVersion, width, height, required, status, reason] = values;
      const job = this.state.jobs.find((entry) => entry.id === String(jobId));
      job?.assets.push({
        asset_id: String(assetId),
        kind: String(kind),
        content_type: String(contentType),
        checksum_sha256: checksum ? String(checksum) : null,
        object_version: objectVersion ? String(objectVersion) : null,
        width: width === null ? null : Number(width),
        height: height === null ? null : Number(height),
        required: Boolean(required),
        status: String(status),
        omission_reason: reason ? String(reason) : null,
      });
      return { rows: [] };
    }
    return { rows: [] };
  }

  private asJsonJob(job: FakeExportJob | undefined): Record<string, unknown> {
    if (!job) return {};
    return {
      id: job.id,
      tripId: job.trip_id,
      ownerId: job.owner_id,
      createdBy: job.created_by,
      idempotencyKey: job.idempotency_key,
      tripVersion: job.trip_version,
      status: job.status,
      stage: job.stage,
      options: clone(job.options),
      optionsHash: job.options_hash,
      templateVersion: job.template_version,
      templateHash: job.template_hash,
      snapshotSchemaVersion: job.snapshot_schema_version,
      snapshot: clone(job.snapshot),
      snapshotHash: job.snapshot_hash,
      omissionCount: job.omission_count,
      warnings: clone(job.warnings),
      assetManifest: clone(job.assets),
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
      completedAt: job.completed_at,
    };
  }

  complete(jobId: string, status: "completed" | "completed_with_warnings" = "completed"): void {
    const job = this.state.jobs.find((entry) => entry.id === jobId);
    if (job) {
      job.status = status;
      job.completed_at = "2026-08-13T00:00:00.000Z";
    }
  }
}

function snapshotState(value: string, _state: FakeExportState): void {
  void value;
}

export function exportState(overrides: Partial<FakeExportState> = {}): FakeExportState {
  return {
    trip: {
      id: "00000000-0000-4000-8000-000000000001",
      owner_id: "owner-1",
      name: "Fixture trip",
      start_date: "2026-08-01",
      end_date: "2026-08-02",
      total_days: 2,
      travelers: 1,
      default_currency: "CNY",
      budget: null,
      timezone: "Asia/Shanghai",
      map_profile: "cn_primary",
      description: "A frozen export fixture",
      status: "active",
      version: 3,
    },
    days: [{ id: "day-1", day_number: 1, date: "2026-08-01", day_of_week: 6, is_workday: false, version: 1, route_generation: 1 }],
    items: [{ id: "item-1", trip_day_id: "day-1", item_type: "attraction", time_kind: "unscheduled", start_time: null, end_time: null, end_day_offset: 0, time_zone: null, time_period: null, target: "Museum", description: "A place", duration_minutes: null, destination_id: null, location_id: "location-1", start_location_id: null, end_location_id: null, transport_mode_code: null, remark: null, external_source: null, external_id: null, sort_order: 0, version: 1, created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z", location_name: "Museum", location_address: "Museum Road", location_point: { longitude: 121.47, latitude: 31.23 }}],
    expenses: [],
    routes: [],
    attachments: [],
    mediaTasks: [],
    destinations: [],
    jobs: [],
    ...clone(overrides),
  };
}

export function attachment(status: string, id = "attachment-1"): FakeAttachment {
  const ready = status === "ready";
  return {
    id,
    itinerary_item_id: "item-1",
    import_media_task_id: null,
    object_key: `attachments/${id}`,
    status,
    object_version: ready ? "v1" : null,
    checksum_sha256: ready ? "A".repeat(43) + "=" : null,
    content_type: "image/png",
    content_length: ready ? 100 : 0,
    width: ready ? 100 : null,
    height: ready ? 100 : null,
    caption: null,
    sort_order: 0,
    is_cover: false,
    version: 1,
  };
}

export function mediaTask(status: string, id = "media-task-1", attachmentId: string | null = null): FakeMediaTask {
  return {
    id,
    itinerary_item_id: status === "awaiting_approval" || status === "approved" || status === "queued" ? null : "item-1",
    attachment_id: attachmentId,
    source_row_key: "Sheet:2",
    url_ordinal: 0,
    status,
    error_code: ["failed", "rejected"].includes(status) ? "MEDIA_IMPORT_FAILED" : null,
  };
}
