import { createHash, randomUUID } from "node:crypto";

import {
  normalizeImportRow,
  stableFingerprint,
  validateNormalizedRow,
} from "@on-the-road/importer";
import { PostgresExecutor } from "@on-the-road/database/postgres";
import { encryptImportMediaUrl } from "./media-url-crypto.js";

type ImportRowRecord = {
  id: string;
  source_row_key: string;
  raw_data: Record<string, unknown>;
};

type ImportJobRecord = {
  id: string;
  mapping: Record<string, string>;
  status: string;
  trip_id: string;
  owner_id: string;
};

export type ImportStagingResult = Readonly<{
  jobId: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  unresolvedRows: number;
}>;

export class PostgresImportStagingProcessor {
  readonly #database: PostgresExecutor;

  readonly #mediaSecret: string;
  readonly #mediaKeyVersion: string;

  constructor(databaseUrl: string, options: { mediaSecret?: string; mediaKeyVersion?: string } = {}) {
    this.#database = new PostgresExecutor({ databaseUrl, role: "worker" });
    this.#mediaSecret = options.mediaSecret ?? "wave1-test-only-import-media-secret";
    this.#mediaKeyVersion = options.mediaKeyVersion ?? "runtime-v1";
  }

  async process(jobId: string): Promise<ImportStagingResult> {
    return this.#database.transaction(async (client) => {
      const job = (await client.query<ImportJobRecord>(
        `SELECT id, mapping, status, trip_id, owner_id
         FROM import_job
         WHERE id = $1::uuid
         FOR UPDATE`,
        [jobId],
      )).rows[0];
      if (!job) throw new Error("IMPORT_JOB_NOT_FOUND");
      if (!["validating", "confirmation_required"].includes(job.status)) {
        throw new Error("IMPORT_JOB_NOT_STAGEABLE");
      }

      const rows = (await client.query<ImportRowRecord>(
        `SELECT id, source_row_key, raw_data
         FROM import_row
         WHERE import_job_id = $1::uuid
           AND status <> 'imported'
         ORDER BY sheet_name, row_number, id
         FOR UPDATE`,
        [jobId],
      )).rows;
      const targetToSource = Object.fromEntries(
        Object.entries(job.mapping).map(([source, target]) => [target, source]),
      );
      const fingerprints = new Set<string>();
      let validRows = 0;
      let errorRows = 0;
      let duplicateRows = 0;
      let unresolvedRows = 0;

      for (const row of rows) {
        const normalized = normalizeImportRow(row.raw_data, targetToSource);
        const errors = validateNormalizedRow(
          normalized as Parameters<typeof validateNormalizedRow>[0],
        );
        const fingerprint = stableFingerprint(normalized);
        const externalSource = typeof normalized.externalSource === "string" ? normalized.externalSource.trim() : "";
        const externalId = typeof normalized.externalId === "string" ? normalized.externalId.trim() : "";
        const existingExternal = externalSource && externalId
          ? (await client.query<{ id: string }>(
            `SELECT id
             FROM itinerary_item
             WHERE trip_id = $1::uuid AND owner_id = $2
               AND external_source = $3 AND external_id = $4
               AND deleted_at IS NULL
             FOR UPDATE`,
            [job.trip_id, job.owner_id, externalSource, externalId],
          )).rows[0]
          : undefined;
        const existingClaim = (await client.query<{ id: string }>(
          `SELECT id
           FROM import_fingerprint_claim
           WHERE trip_id = $1::uuid AND row_fingerprint = $2 AND claim_scope = 'trip'
           LIMIT 1`,
          [job.trip_id, fingerprint],
        )).rows[0];
        let status: "new" | "update" | "error" | "duplicate" | "unresolved";
        if (errors.length > 0) {
          status = "error";
          errorRows += 1;
        } else if (existingExternal) {
          status = "update";
          validRows += 1;
        } else if (fingerprints.has(fingerprint) || existingClaim) {
          status = "duplicate";
          duplicateRows += 1;
        } else if (requiresLocationResolution(normalized)) {
          status = "unresolved";
          unresolvedRows += 1;
          validRows += 1;
        } else {
          status = "new";
          validRows += 1;
        }
        fingerprints.add(fingerprint);
        await client.query(
          `UPDATE import_row
           SET normalized_data = $2::jsonb,
               fingerprint = $3,
               status = $4,
               errors = $5::jsonb,
               updated_at = now()
           WHERE id = $1::uuid`,
          [
            row.id,
            JSON.stringify(normalized),
            fingerprint,
            status,
            JSON.stringify(errors),
          ],
        );
        if (status === "unresolved") {
          await this.#ensureLocationStaging(client, job, row, normalized);
        }
        await this.#registerMediaTasks(client, job, row.id, row.source_row_key, normalized);
      }

      await client.query(
        `UPDATE import_job
         SET status = 'confirmation_required',
             stage = 'confirmation_required',
             total_rows = $2,
             valid_rows = $3,
             error_rows = $4,
             updated_at = now()
         WHERE id = $1::uuid`,
        [jobId, rows.length, validRows, errorRows],
      );
      return {
        jobId,
        totalRows: rows.length,
        validRows,
        errorRows,
        duplicateRows,
        unresolvedRows,
      };
    });
  }

  async listRecoverableJobIds(limit = 100): Promise<string[]> {
    return (await this.#database.query<{ id: string }>(
      `SELECT id
       FROM import_job
       WHERE status = 'validating'
       ORDER BY updated_at, id
       LIMIT $1`,
      [limit],
    )).rows.map(({ id }) => id);
  }

  async #ensureLocationStaging(
    client: import("@on-the-road/database/postgres").PoolClient,
    job: ImportJobRecord,
    row: ImportRowRecord,
    normalized: Record<string, unknown>,
  ): Promise<void> {
    const inputText = locationInputText(normalized);
    if (!inputText) return;
    await client.query(
      `INSERT INTO import_location_staging (
         trip_id, owner_id, source_row_key, staged_location, status, version
       ) VALUES ($1::uuid, $2, $3, $4::jsonb, 'staged', 1)
       ON CONFLICT (trip_id, source_row_key) DO UPDATE
         SET staged_location = EXCLUDED.staged_location,
             status = CASE
               WHEN import_location_staging.status = 'consumed' THEN import_location_staging.status
               ELSE 'staged'
             END,
             version = import_location_staging.version + 1,
             updated_at = now()`,
      [
        job.trip_id,
        job.owner_id,
        `${job.id}:${row.source_row_key}`,
        JSON.stringify({
          inputText,
          sourceRowKey: row.source_row_key,
          importJobId: job.id,
          importRowId: row.id,
        }),
      ],
    );
  }

  close(): Promise<void> {
    return this.#database.close();
  }

  async #registerMediaTasks(
    client: import("@on-the-road/database/postgres").PoolClient,
    job: ImportJobRecord,
    rowId: string,
    sourceRowKey: string,
    normalized: Record<string, unknown>,
  ): Promise<void> {
    const urls = Array.isArray(normalized.imageUrls)
      ? normalized.imageUrls.filter((value): value is string => typeof value === "string" && /^https?:\/\//iu.test(value))
      : [];
    for (const [ordinal, url] of urls.entries()) {
      const encrypted = encryptImportMediaUrl(url, this.#mediaSecret, this.#mediaKeyVersion);
      await client.query(
        `INSERT INTO import_media_task (
           id, trip_id, owner_id, import_job_id, import_row_id, source_row_key,
           url_ordinal, source_url_sha256, source_url_ciphertext,
           source_url_key_version, source_url_expires_at, status
         ) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6,
           $7, $8, $9::bytea, $10, now() + interval '30 days', 'awaiting_approval')
         ON CONFLICT (import_job_id, source_row_key, url_ordinal) DO NOTHING`,
        [randomUUID(), job.trip_id, job.owner_id, job.id, rowId, sourceRowKey, ordinal,
          createHash("sha256").update(url).digest("hex"), encrypted.ciphertext, encrypted.keyVersion],
      );
    }
  }
}

function requiresLocationResolution(normalized: Record<string, unknown>): boolean {
  const hasCoordinates = normalized.latitude !== null
    && normalized.longitude !== null;
  const hasLocationInput = [
    normalized.address,
    normalized.place,
    normalized.startLocation,
    normalized.endLocation,
  ].some((value) => typeof value === "string" && value.trim().length > 0);
  return hasLocationInput && !hasCoordinates;
}

function locationInputText(normalized: Record<string, unknown>): string | null {
  for (const key of ["address", "place", "startLocation", "endLocation"]) {
    const value = normalized[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
