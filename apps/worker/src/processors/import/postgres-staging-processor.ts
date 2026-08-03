import {
  normalizeImportRow,
  stableFingerprint,
  validateNormalizedRow,
} from "@on-the-road/importer";
import { PostgresExecutor } from "@on-the-road/database/postgres";

type ImportRowRecord = {
  id: string;
  raw_data: Record<string, unknown>;
};

type ImportJobRecord = {
  id: string;
  mapping: Record<string, string>;
  status: string;
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

  constructor(databaseUrl: string) {
    this.#database = new PostgresExecutor({ databaseUrl, role: "worker" });
  }

  async process(jobId: string): Promise<ImportStagingResult> {
    return this.#database.transaction(async (client) => {
      const job = (await client.query<ImportJobRecord>(
        `SELECT id, mapping, status
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
        `SELECT id, raw_data
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
        let status: "new" | "error" | "duplicate" | "unresolved";
        if (errors.length > 0) {
          status = "error";
          errorRows += 1;
        } else if (fingerprints.has(fingerprint)) {
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

  close(): Promise<void> {
    return this.#database.close();
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
