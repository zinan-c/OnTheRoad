import { createHash } from "node:crypto";

import { PostgresExecutor } from "@on-the-road/database/postgres";
import type { ImportInspectJob, ImportInspectRepository, ImportSourceAttachment, WorkbookInspection } from "./inspect.js";

export class PostgresImportInspectRepository implements ImportInspectRepository {
  readonly #database: PostgresExecutor;

  constructor(databaseUrl: string) {
    this.#database = new PostgresExecutor({ databaseUrl, role: "worker" });
  }

  async claimJob(id: string): Promise<ImportInspectJob> {
    const row = await this.#database.json<any>(`UPDATE import_inspect_job SET status = 'processing', attempts = attempts + 1, started_at = COALESCE(started_at, now()), updated_at = now() WHERE id = $1::uuid AND status = 'queued' RETURNING jsonb_build_object('id', id, 'ownerId', owner_id, 'attachmentId', attachment_id, 'status', status, 'attempts', attempts)::jsonb`, [id]);
    if (!row) throw new Error("IMPORT_INSPECT_JOB_NOT_QUEUED");
    return row;
  }

  getJob(id: string): Promise<ImportInspectJob> {
    return this.#database.json(`SELECT jsonb_build_object('id', id, 'ownerId', owner_id, 'attachmentId', attachment_id, 'status', status, 'attempts', attempts)::jsonb FROM import_inspect_job WHERE id = $1::uuid`, [id]);
  }

  getAttachment(id: string): Promise<ImportSourceAttachment> {
    return this.#database.json(`SELECT jsonb_build_object('id', id, 'ownerId', owner_id, 'filename', source_filename, 'status', status, 'objectKey', object_key, 'objectVersion', object_version, 'checksumSha256', checksum_sha256, 'contentLength', content_length, 'scanEngine', scan_engine, 'scanCompletedAt', scan_completed_at, 'version', version) FROM attachment WHERE id = $1::uuid`, [id]);
  }

  recordCleanScan(id: string, evidence: { scanner: string; objectVersion: string; checksumSha256: string; scannedAt: string; expectedVersion: number }): Promise<ImportSourceAttachment> {
    return this.#database.json(`SELECT mark_import_attachment_scan_clean($1::uuid, $2, $3, $4, $5)`, [id, evidence.expectedVersion, evidence.objectVersion, evidence.checksumSha256, evidence.scanner]);
  }

  markAttachmentFailed(id: string, errorCode: string): Promise<ImportSourceAttachment> {
    return this.#database.json(`UPDATE attachment SET status = 'failed', processing_error_code = $2, version = version + 1, updated_at = now() WHERE id = $1::uuid RETURNING jsonb_build_object('id', id, 'status', status, 'version', version)::jsonb`, [id, errorCode]);
  }

  async markSucceeded(id: string, inspection: WorkbookInspection): Promise<ImportInspectJob> {
    return this.#database.transaction(async (client) => {
      const publicInspection = {
        ...inspection,
        sheets: inspection.sheets.map(({ rows: _rows, ...sheet }) => sheet),
      };
      const job = (await client.query<any>(`UPDATE import_inspect_job SET status = 'succeeded', inspection = $2::jsonb, completed_at = now(), updated_at = now() WHERE id = $1::uuid RETURNING id, owner_id, attachment_id, trip_id, status, attempts`, [id, JSON.stringify(publicInspection)])).rows[0];
      if (!job) throw new Error("IMPORT_INSPECT_JOB_NOT_FOUND");
      const attachment = (await client.query<any>(`SELECT source_filename, checksum_sha256 FROM attachment WHERE id = $1::uuid`, [job.attachment_id])).rows[0];
      const sourceSha256 = Buffer.from(attachment.checksum_sha256, "base64").toString("hex");
      const mappingHash = createHash("sha256").update("{}").digest("hex");
      const totalRows = inspection.sheets.reduce(
        (sum, sheet) => sum + (sheet.rows ?? sheet.samples).length,
        0,
      );
      const imported = (await client.query<any>(`INSERT INTO import_job (trip_id, owner_id, source_attachment_id, source_sha256, importer_type, importer_version, mapping, mapping_hash, status, stage, total_rows, valid_rows, error_rows) VALUES ($1::uuid, $2, $3::uuid, $4, split_part($5, '.', 2), 'runtime-1', '{}'::jsonb, $6, 'mapping_required', 'mapping_required', $7, 0, 0) RETURNING id`, [job.trip_id, job.owner_id, job.attachment_id, sourceSha256, attachment.source_filename, mappingHash, totalRows])).rows[0];
      for (const sheet of inspection.sheets) {
        for (const [index, rawData] of (sheet.rows ?? sheet.samples).entries()) {
          const rowNumber = index + 2;
          await client.query(`INSERT INTO import_row (import_job_id, sheet_name, row_number, source_row_key, raw_data, status) VALUES ($1::uuid, $2, $3, $4, $5::jsonb, 'pending')`, [imported.id, sheet.name, rowNumber, `${sheet.name}:${rowNumber}`, JSON.stringify(rawData)]);
        }
      }
      return { id: job.id, ownerId: job.owner_id, attachmentId: job.attachment_id, status: job.status, attempts: job.attempts };
    });
  }

  async markFailed(id: string, error: { code: string; message: string; retryable: boolean }): Promise<ImportInspectJob> {
    return this.#database.json(`UPDATE import_inspect_job SET status = 'failed', error_code = $2, error_message = $3, retryable = $4, completed_at = now(), updated_at = now() WHERE id = $1::uuid RETURNING jsonb_build_object('id', id, 'status', status, 'attempts', attempts)::jsonb`, [id, error.code, error.message, error.retryable]);
  }

  close(): Promise<void> { return this.#database.close(); }
}
