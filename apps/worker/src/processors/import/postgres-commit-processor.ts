import { PostgresExecutor, type PoolClient } from "@on-the-road/database/postgres";
import {
  IMPORT_COMMIT_CHUNK_SIZE,
  importFingerprintClaimScope,
} from "@on-the-road/application/import/commit";

type ImportJobRecord = {
  id: string;
  trip_id: string;
  owner_id: string;
  source_sha256: string;
  importer_version: string;
  mapping_hash: string;
  status: string;
  committed_rows: number;
  error_rows: number;
  default_currency: string;
};

type ImportRowRecord = {
  id: string;
  source_row_key: string;
  normalized_data: Record<string, unknown>;
  fingerprint: string;
  status: string;
  decision_scope: string;
  override_decision_id: string | null;
  override_reason: string | null;
};

export type ImportCommitChunkResult = Readonly<{
  jobId: string;
  committedRows: number;
  insertedRows: number;
  updatedRows: number;
  skippedRows: number;
  mediaTaskIds: readonly string[];
  hasMore: boolean;
  status: string;
}>;

type CommitCounts = {
  committedRows: number;
  insertedRows: number;
  updatedRows: number;
  skippedRows: number;
  mediaTaskIds: string[];
};

const COMMITABLE_STATUSES = ["new", "update", "duplicate", "ready"];

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function itemType(row: Record<string, unknown>): string {
  if (stringValue(row.hotel)) return "hotel";
  if (stringValue(row.dining)) return "dining";
  return "activity";
}

export class ImportCommitProcessorError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "ImportCommitProcessorError";
    this.code = code;
    this.retryable = retryable;
  }
}

export class PostgresImportCommitProcessor {
  readonly #database: PostgresExecutor;
  readonly #chunkSize: number;

  constructor(options: {
    databaseUrl?: string;
    executor?: PostgresExecutor;
    chunkSize?: number;
    mediaSecret?: string;
    mediaKeyVersion?: string;
    clock?: () => Date;
  }) {
    this.#database = options.executor ?? new PostgresExecutor({
      databaseUrl: options.databaseUrl,
      role: "worker",
    });
    this.#chunkSize = options.chunkSize ?? IMPORT_COMMIT_CHUNK_SIZE;
    if (!Number.isSafeInteger(this.#chunkSize) || this.#chunkSize < 1 || this.#chunkSize > 500) {
      throw new RangeError("Import commit chunk size must be between 1 and 500");
    }
  }

  async process(jobId: string): Promise<ImportCommitChunkResult> {
    let aggregate: CommitCounts = {
      committedRows: 0,
      insertedRows: 0,
      updatedRows: 0,
      skippedRows: 0,
      mediaTaskIds: [],
    };
    let result: ImportCommitChunkResult;
    do {
      result = await this.processChunk(jobId);
      aggregate = {
        committedRows: aggregate.committedRows + result.committedRows,
        insertedRows: aggregate.insertedRows + result.insertedRows,
        updatedRows: aggregate.updatedRows + result.updatedRows,
        skippedRows: aggregate.skippedRows + result.skippedRows,
        mediaTaskIds: [...aggregate.mediaTaskIds, ...result.mediaTaskIds],
      };
    } while (result.hasMore && result.status === "importing");
    return { ...result, ...aggregate };
  }

  async listRecoverableJobIds(limit = 100): Promise<string[]> {
    const result = await this.#database.query<{ id: string }>(
      `SELECT id
       FROM import_job
       WHERE status IN ('ready_to_import', 'importing')
       ORDER BY updated_at, id
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(({ id }) => id);
  }

  async processChunk(jobId: string): Promise<ImportCommitChunkResult> {
    return this.#database.transaction(async (client) => {
      const job = (await client.query<ImportJobRecord>(
        `SELECT j.id, j.trip_id, j.owner_id, j.source_sha256,
                j.importer_version, j.mapping_hash, j.status,
                j.committed_rows, j.error_rows, t.default_currency
         FROM import_job j
         JOIN trip t ON t.id = j.trip_id AND t.owner_id = j.owner_id
         WHERE j.id = $1::uuid
         FOR UPDATE`,
        [jobId],
      )).rows[0];
      if (!job) throw new ImportCommitProcessorError("IMPORT_JOB_NOT_FOUND", "Import job was not found.");

      if (job.status === "cancelling") {
        const activeMedia = (await client.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM import_media_task
           WHERE import_job_id = $1::uuid
             AND status NOT IN ('ready', 'failed', 'rejected', 'cancelled')`,
          [jobId],
        )).rows[0]?.count;
        if (Number(activeMedia ?? 0) > 0) return emptyChunk(jobId, "cancelling");
        await client.query(
          `UPDATE import_job
           SET status = 'cancelled', completed_at = now(), updated_at = now()
           WHERE id = $1::uuid AND status = 'cancelling'`,
          [jobId],
        );
        return emptyChunk(jobId, "cancelled");
      }
      if (job.status !== "importing") {
        return emptyChunk(jobId, job.status);
      }

      const rows = (await client.query<ImportRowRecord>(
        `SELECT id, source_row_key, normalized_data, fingerprint, status,
                decision_scope, override_decision_id, override_reason
         FROM import_row
         WHERE import_job_id = $1::uuid
           AND status = ANY($2::text[])
         ORDER BY id
         LIMIT $3
         FOR UPDATE`,
        [jobId, COMMITABLE_STATUSES, this.#chunkSize],
      )).rows;

      if (rows.length === 0) {
        return this.#finish(client, job, jobId);
      }

      const counts: CommitCounts = {
        committedRows: 0,
        insertedRows: 0,
        updatedRows: 0,
        skippedRows: 0,
        mediaTaskIds: [],
      };
      for (const row of rows) {
        const outcome = await this.#commitRow(client, job, row);
        if (outcome.replayed) continue;
        counts.committedRows += 1;
        counts.insertedRows += outcome.action === "insert" ? 1 : 0;
        counts.updatedRows += outcome.action === "update" ? 1 : 0;
        counts.skippedRows += outcome.action === "skip" ? 1 : 0;
        counts.mediaTaskIds.push(...outcome.mediaTaskIds);
      }
      if (counts.committedRows > 0) {
        await client.query(
          `UPDATE import_job
           SET committed_rows = committed_rows + $2,
               imported_rows = imported_rows + $2,
               updated_at = now()
           WHERE id = $1::uuid`,
          [jobId, counts.committedRows],
        );
      }
      const remaining = (await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM import_row
         WHERE import_job_id = $1::uuid AND status = ANY($2::text[])`,
        [jobId, COMMITABLE_STATUSES],
      )).rows[0]?.count;
      if (Number(remaining ?? 0) === 0) {
        const finished = await this.#finish(client, job, jobId);
        return {
          jobId,
          ...counts,
          hasMore: false,
          status: finished.status,
        };
      }
      return {
        jobId,
        ...counts,
        hasMore: Number(remaining ?? 0) > 0,
        status: "importing",
      };
    });
  }

  async #commitRow(client: PoolClient, job: ImportJobRecord, row: ImportRowRecord): Promise<{
    action: "insert" | "update" | "skip";
    replayed: boolean;
    mediaTaskIds: string[];
  }> {
    const replay = (await client.query<{ action: "insert" | "update" | "skip"; itinerary_item_id: string | null }>(
      `SELECT action, itinerary_item_id
       FROM import_commit_ledger
       WHERE trip_id = $1::uuid
         AND source_sha256 = $2
         AND importer_version = $3
         AND mapping_hash = $4
         AND source_row_key = $5
         AND decision_scope = $6
       FOR UPDATE`,
      [job.trip_id, job.source_sha256, job.importer_version, job.mapping_hash, row.source_row_key, row.decision_scope],
    )).rows[0];
    if (replay) {
      await client.query(
        `UPDATE import_row
         SET status = 'imported', imported_item_id = $2::uuid, updated_at = now()
         WHERE id = $1::uuid AND status <> 'imported'`,
        [row.id, replay.itinerary_item_id],
      );
      const mediaTaskIds = replay.itinerary_item_id
        ? await this.#bindMediaTasks(client, job.id, row.id, replay.itinerary_item_id)
        : await this.#cancelMediaTasks(client, job.id, row.id);
      return { action: replay.action, replayed: true, mediaTaskIds };
    }

    // A duplicate detected during staging is not a second insert. Only an
    // explicit, auditable override changes its decision scope to an insert.
    if (row.status === "duplicate" && row.decision_scope === "default") {
      await client.query(
        `INSERT INTO import_fingerprint_claim (
           trip_id, owner_id, row_fingerprint, claim_scope,
           import_job_id, import_row_id
         ) VALUES ($1::uuid, $2, $3, 'trip', $4::uuid, $5::uuid)
         ON CONFLICT (trip_id, row_fingerprint, claim_scope) DO NOTHING`,
        [job.trip_id, job.owner_id, row.fingerprint, job.id, row.id],
      );
      await client.query(
        `INSERT INTO import_commit_ledger (
           trip_id, owner_id, import_job_id, import_row_id,
           source_sha256, importer_version, mapping_hash, source_row_key,
           row_fingerprint, action, decision_scope
         ) VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, 'skip', 'default')`,
        [job.trip_id, job.owner_id, job.id, row.id, job.source_sha256,
          job.importer_version, job.mapping_hash, row.source_row_key, row.fingerprint],
      );
      await client.query(
        `UPDATE import_row SET status = 'imported', updated_at = now() WHERE id = $1::uuid`,
        [row.id],
      );
      return { action: "skip", replayed: false, mediaTaskIds: await this.#cancelMediaTasks(client, job.id, row.id) };
    }

    const normalized = row.normalized_data;
    const claimScope = importFingerprintClaimScope(row.decision_scope);
    let action: "insert" | "update" | "skip" = "insert";
    let itemId: string | null = null;
    let ownedClaimScope: string | null = null;
    if (row.status === "update") {
      if (row.override_decision_id) {
        throw new ImportCommitProcessorError(
          "IMPORT_UPDATE_OVERRIDE_FORBIDDEN",
          "An update row cannot use a duplicate insert override.",
        );
      }
      const externalSource = stringValue(normalized.externalSource);
      const externalId = stringValue(normalized.externalId);
      const target = externalSource && externalId
        ? (await client.query<{ id: string; version: number }>(
          `SELECT id, version
           FROM itinerary_item
           WHERE trip_id = $1::uuid AND owner_id = $2
             AND external_source = $3 AND external_id = $4
             AND deleted_at IS NULL
           FOR UPDATE`,
          [job.trip_id, job.owner_id, externalSource, externalId],
        )).rows[0]
        : undefined;
      if (!target) {
        action = "skip";
      } else {
        const claim = (await client.query<{ itinerary_item_id: string | null }>(
          `INSERT INTO import_fingerprint_claim (
             trip_id, owner_id, row_fingerprint, claim_scope,
             import_job_id, import_row_id, itinerary_item_id
           ) VALUES ($1::uuid, $2, $3, 'trip', $4::uuid, $5::uuid, $6::uuid)
           ON CONFLICT (trip_id, row_fingerprint, claim_scope) DO NOTHING
           RETURNING itinerary_item_id`,
          [job.trip_id, job.owner_id, row.fingerprint, job.id, row.id, target.id],
        )).rows[0] ?? (await client.query<{ itinerary_item_id: string | null }>(
          `SELECT itinerary_item_id
           FROM import_fingerprint_claim
           WHERE trip_id = $1::uuid AND row_fingerprint = $2 AND claim_scope = 'trip'
           FOR UPDATE`,
          [job.trip_id, row.fingerprint],
        )).rows[0];
        if (claim?.itinerary_item_id && claim.itinerary_item_id !== target.id) {
          action = "skip";
          itemId = claim.itinerary_item_id;
        } else {
          itemId = await this.#updateItem(client, job, target, normalized);
          action = "update";
          ownedClaimScope = "trip";
        }
      }
    } else {
      const claim = await client.query<{ itinerary_item_id: string | null }>(
        `INSERT INTO import_fingerprint_claim (
           trip_id, owner_id, row_fingerprint, claim_scope,
           import_job_id, import_row_id, override_decision_id, override_reason
         ) VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6::uuid, $7::uuid, $8)
         ON CONFLICT (trip_id, row_fingerprint, claim_scope) DO NOTHING
         RETURNING itinerary_item_id`,
        [job.trip_id, job.owner_id, row.fingerprint, claimScope, job.id, row.id,
          row.override_decision_id, row.override_reason],
      );
      if (claim.rows.length === 0) {
        action = "skip";
        itemId = (await client.query<{ itinerary_item_id: string | null }>(
          `SELECT itinerary_item_id
           FROM import_fingerprint_claim
           WHERE trip_id = $1::uuid AND row_fingerprint = $2 AND claim_scope = $3
           FOR UPDATE`,
          [job.trip_id, row.fingerprint, claimScope],
        )).rows[0]?.itinerary_item_id ?? null;
      } else {
        ownedClaimScope = claimScope;
      }
    }

    if (action === "insert") {
      const dayId = await this.#dayId(client, job.trip_id, normalized);
      const locationId = await this.#locationId(client, job, normalized);
      itemId = await this.#insertItem(client, job, dayId, locationId, normalized);
      await this.#insertExpense(client, job, dayId, itemId, normalized);
    }

    if (ownedClaimScope) {
      await client.query(
        `UPDATE import_fingerprint_claim
         SET itinerary_item_id = COALESCE(itinerary_item_id, $2::uuid)
         WHERE trip_id = $1::uuid AND row_fingerprint = $3 AND claim_scope = $4
           AND import_job_id = $5::uuid AND import_row_id = $6::uuid`,
        [job.trip_id, itemId, row.fingerprint, ownedClaimScope, job.id, row.id],
      );
    }
    await client.query(
      `INSERT INTO import_commit_ledger (
         trip_id, owner_id, import_job_id, import_row_id, itinerary_item_id,
         source_sha256, importer_version, mapping_hash, source_row_key,
         row_fingerprint, action, decision_scope, override_decision_id, override_reason
       ) VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid,
         $6, $7, $8, $9, $10, $11, $12, $13::uuid, $14)`,
      [job.trip_id, job.owner_id, job.id, row.id, itemId,
        job.source_sha256, job.importer_version, job.mapping_hash, row.source_row_key,
        row.fingerprint, action, row.decision_scope, row.override_decision_id, row.override_reason],
    );
    await client.query(
      `UPDATE import_row
       SET status = 'imported', imported_item_id = $2::uuid, updated_at = now()
       WHERE id = $1::uuid`,
      [row.id, itemId],
    );
    if (row.override_decision_id) {
      await client.query(
        `UPDATE import_override_decision
         SET consumed_at = COALESCE(consumed_at, now())
         WHERE id = $1::uuid AND import_job_id = $2::uuid`,
        [row.override_decision_id, job.id],
      );
    }

    const mediaTaskIds = action === "skip" || !itemId
      ? await this.#cancelMediaTasks(client, job.id, row.id)
      : await this.#createMediaTasks(client, job, row, itemId, normalized);
    return { action, replayed: false, mediaTaskIds };
  }

  async #dayId(client: PoolClient, tripId: string, row: Record<string, unknown>): Promise<string> {
    const day = numberValue(row.day);
    const date = stringValue(row.date);
    const result = await client.query<{ id: string }>(
      `SELECT id
       FROM trip_day
       WHERE trip_id = $1::uuid
         AND (($2::integer IS NOT NULL AND day_number = $2::integer)
           OR ($2::integer IS NULL AND $3::date IS NOT NULL AND date = $3::date))
       ORDER BY day_number
       LIMIT 1`,
      [tripId, day, date],
    );
    if (!result.rows[0]) {
      throw new ImportCommitProcessorError("IMPORT_DAY_NOT_FOUND", "The import row does not match a trip day.");
    }
    return result.rows[0].id;
  }

  async #locationId(client: PoolClient, job: ImportJobRecord, row: Record<string, unknown>): Promise<string | null> {
    const latitude = numberValue(row.latitude);
    const longitude = numberValue(row.longitude);
    if (latitude === null || longitude === null) return null;
    const inputText = stringValue(row.address) ?? stringValue(row.place) ?? stringValue(row.target);
    if (!inputText) return null;
    const name = stringValue(row.place) ?? stringValue(row.target) ?? inputText;
    const result = await client.query<{ id: string }>(
      `SELECT create_location($1::jsonb)->>'id' AS id`,
      [JSON.stringify({
        tripId: job.trip_id,
        ownerId: job.owner_id,
        inputText,
        name,
      })],
    );
    const locationId = result.rows[0]?.id;
    if (!locationId) return null;
    await client.query(
      `SELECT transition_location(
         $1, $2::uuid, 1, 'resolved', $3::jsonb
       )`,
      [job.owner_id, locationId, JSON.stringify({
        point: { longitude, latitude, crs: "WGS84" },
        provider: "import",
        sourceCrs: "EPSG:4326",
      })],
    );
    return locationId;
  }

  async #insertItem(client: PoolClient, job: ImportJobRecord, dayId: string, locationId: string | null, row: Record<string, unknown>): Promise<string> {
    const target = stringValue(row.target) ?? stringValue(row.place) ?? stringValue(row.hotel) ?? stringValue(row.dining) ?? stringValue(row.description);
    const externalSource = stringValue(row.externalSource);
    const externalId = stringValue(row.externalId);
    const result = await client.query<{ value: Record<string, unknown> }>(
      `SELECT create_itinerary_item($1, $2::uuid, $3::jsonb) AS value`,
      [job.owner_id, job.trip_id, JSON.stringify({
        tripDayId: dayId,
        itemType: itemType(row),
        timeKind: "unscheduled",
        endDayOffset: 0,
        target,
        description: stringValue(row.description),
        durationMinutes: numberValue(row.durationMinutes),
        locationId,
        transportModeCode: stringValue(row.mode),
        remark: stringValue(row.remark),
        ...(externalSource && externalId ? { externalSource, externalId } : {}),
      })],
    );
    const value = result.rows[0]?.value;
    const id = typeof value?.id === "string" ? value.id : null;
    if (!id) throw new ImportCommitProcessorError("IMPORT_ITEM_CREATE_FAILED", "The imported itinerary item was not created.");
    return id;
  }

  async #updateItem(client: PoolClient, job: ImportJobRecord, target: { id: string; version: number }, row: Record<string, unknown>): Promise<string> {
    const current = (await client.query<{ value: Record<string, unknown> }>(
      `SELECT itinerary_item_as_json($1::uuid) AS value`, [target.id],
    )).rows[0]?.value ?? {};
    const result = await client.query<{ value: Record<string, unknown> }>(
      `SELECT update_itinerary_item($1, $2::uuid, $3::uuid, $4::integer, $5::jsonb) AS value`,
      [job.owner_id, job.trip_id, target.id, target.version, JSON.stringify({
        ...current,
        target: stringValue(row.target) ?? current.target ?? null,
        description: stringValue(row.description) ?? current.description ?? null,
        durationMinutes: numberValue(row.durationMinutes) ?? current.durationMinutes ?? null,
        remark: stringValue(row.remark) ?? current.remark ?? null,
      })],
    );
    const id = typeof result.rows[0]?.value?.id === "string" ? result.rows[0].value.id : null;
    if (!id) throw new ImportCommitProcessorError("IMPORT_ITEM_UPDATE_FAILED", "The imported itinerary item was not updated.");
    return id;
  }

  async #insertExpense(client: PoolClient, job: ImportJobRecord, dayId: string, itemId: string, row: Record<string, unknown>): Promise<void> {
    const amount = numberValue(row.cost);
    const currency = stringValue(row.currency);
    if (amount === null || !currency) return;
    const category = stringValue(row.costCategory) ?? "OTHER";
    const settled = currency === job.default_currency;
    await client.query(
      `INSERT INTO expense (
         trip_id, owner_id, trip_day_id, itinerary_item_id, category_code,
         transport_mode_code, original_amount, original_currency,
         settlement_amount, settlement_currency, exchange_rate_snapshot,
         source, remark
       ) VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6,
         $7::numeric, $8, $9::numeric, $10, $11::numeric, 'actual', $12)`,
      [job.trip_id, job.owner_id, dayId, itemId, category, stringValue(row.mode),
        amount, currency, settled ? amount : null, job.default_currency,
        settled ? 1 : null, stringValue(row.remark)],
    );
  }

  async #createMediaTasks(client: PoolClient, job: ImportJobRecord, row: ImportRowRecord, itemId: string, normalized: Record<string, unknown>): Promise<string[]> {
    void normalized;
    const result = await client.query<{ id: string; status: string }>(
      `UPDATE import_media_task
       SET itinerary_item_id = $3::uuid,
           status = CASE WHEN import_media_task.status = 'approved' THEN 'queued' ELSE import_media_task.status END,
           next_attempt_at = CASE WHEN import_media_task.status = 'approved' THEN NULL ELSE import_media_task.next_attempt_at END,
           error_code = CASE WHEN import_media_task.status = 'approved' THEN NULL ELSE import_media_task.error_code END,
           error_detail = CASE WHEN import_media_task.status = 'approved' THEN NULL ELSE import_media_task.error_detail END,
           updated_at = now(), version = version + 1
       WHERE import_job_id = $1::uuid AND import_row_id = $2::uuid
         AND itinerary_item_id IS NULL
         AND status NOT IN ('cancelled', 'rejected')
       RETURNING id, status`,
      [job.id, row.id, itemId],
    );
    return result.rows.filter(({ status }) => status === "queued").map(({ id }) => id);
  }

  async #bindMediaTasks(client: PoolClient, jobId: string, rowId: string, itemId: string): Promise<string[]> {
    const result = await client.query<{ id: string; status: string }>(
      `UPDATE import_media_task
       SET itinerary_item_id = $3::uuid,
           status = CASE WHEN import_media_task.status = 'approved' THEN 'queued' ELSE import_media_task.status END,
           next_attempt_at = CASE WHEN import_media_task.status = 'approved' THEN NULL ELSE import_media_task.next_attempt_at END,
           error_code = CASE WHEN import_media_task.status = 'approved' THEN NULL ELSE import_media_task.error_code END,
           error_detail = CASE WHEN import_media_task.status = 'approved' THEN NULL ELSE import_media_task.error_detail END,
           updated_at = now(), version = version + 1
       WHERE import_job_id = $1::uuid AND import_row_id = $2::uuid
         AND itinerary_item_id IS NULL
         AND status NOT IN ('cancelled', 'rejected')
       RETURNING id, status`,
      [jobId, rowId, itemId],
    );
    return result.rows.filter(({ status }) => status === "queued").map(({ id }) => id);
  }

  async #cancelMediaTasks(client: PoolClient, jobId: string, rowId: string): Promise<string[]> {
    const result = await client.query<{ id: string }>(
      `UPDATE import_media_task
       SET status = 'cancelled', error_code = 'IMPORT_ROW_SKIPPED',
           cancelled_at = COALESCE(cancelled_at, now()), completed_at = COALESCE(completed_at, now()),
           updated_at = now(), version = version + 1
       WHERE import_job_id = $1::uuid AND import_row_id = $2::uuid
         AND status IN ('awaiting_approval', 'approved', 'queued', 'retry_scheduled')
       RETURNING id`,
      [jobId, rowId],
    );
    return result.rows.map(({ id }) => id);
  }

  async #finish(client: PoolClient, job: ImportJobRecord, jobId: string): Promise<ImportCommitChunkResult> {
    const media = (await client.query<{ pending: string; failed: string }>(
      `SELECT
         count(*) FILTER (WHERE status NOT IN ('ready', 'failed', 'rejected', 'cancelled'))::text AS pending,
         count(*) FILTER (WHERE status IN ('failed', 'rejected'))::text AS failed
       FROM import_media_task WHERE import_job_id = $1::uuid`,
      [jobId],
    )).rows[0];
    const pending = Number(media?.pending ?? 0);
    const failed = Number(media?.failed ?? 0);
    const warnings = failed > 0 || job.error_rows > 0;
    const status = pending > 0
      ? "processing_media"
      : warnings ? "completed_with_warnings" : "completed";
    await client.query(
      `UPDATE import_job
       SET status = $2, stage = CASE WHEN $2 = 'processing_media' THEN 'processing_media' ELSE 'completed' END,
           completed_at = CASE WHEN $2 IN ('completed', 'completed_with_warnings') THEN now() ELSE completed_at END,
           updated_at = now()
       WHERE id = $1::uuid AND status = 'importing'`,
      [jobId, status],
    );
    return emptyChunk(jobId, status);
  }

  close(): Promise<void> {
    return this.#database.close();
  }
}

function emptyChunk(jobId: string, status: string): ImportCommitChunkResult {
  return {
    jobId,
    committedRows: 0,
    insertedRows: 0,
    updatedRows: 0,
    skippedRows: 0,
    mediaTaskIds: [],
    hasMore: false,
    status,
  };
}
