import { assertExportSnapshot, type ExportJobStage, type ExportJobStatus, type ExportSection, type ExportSnapshot } from "@on-the-road/application/export";
import { PostgresExecutor } from "@on-the-road/database/postgres";
import { S3ObjectStorage } from "@on-the-road/storage";
import { randomUUID } from "node:crypto";
import type { PdfArtifactStore, PdfExportJobSource } from "./pdf-processor.js";
import type { ClaimedPdfExportJob, ExportStageRepository, PdfExportJob } from "./export-stage-machine.js";

type ExportJobRow = Readonly<{
  id: string;
  status: ExportJobStatus;
  stage: ExportJobStage;
  version: number;
  snapshot_hash: string;
  template_version: string;
  options: { orientation?: unknown; sections?: unknown };
  snapshot: ExportSnapshot;
  worker_id?: string | null;
  lease_token?: string | null;
}>;

function sections(value: unknown): readonly ExportSection[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ExportSection => typeof entry === "string");
}

function mapJob(row: ExportJobRow): PdfExportJob {
  return {
    id: row.id,
    status: row.status,
    stage: row.stage,
    version: Number(row.version),
    snapshotHash: row.snapshot_hash,
    templateVersion: row.template_version,
    options: {
      orientation: row.options?.orientation === "landscape" ? "landscape" : "portrait",
      sections: sections(row.options?.sections),
    },
    ...(row.worker_id ? { workerId: row.worker_id } : {}),
    ...(row.lease_token ? { leaseToken: row.lease_token } : {}),
  };
}

function mapClaimedJob(row: ExportJobRow): ClaimedPdfExportJob {
  const job = mapJob(row);
  if (!row.lease_token) throw new Error("PDF_LEASE_TOKEN_MISSING");
  return { ...job, leaseToken: row.lease_token };
}

export class PostgresExportJobSource implements PdfExportJobSource {
  readonly #database: PostgresExecutor;

  constructor(database: PostgresExecutor) {
    this.#database = database;
  }

  async get(jobId: string): Promise<Readonly<{ job: PdfExportJob; snapshot: ExportSnapshot }> | null> {
    const result = await this.#database.query<ExportJobRow>(
      `SELECT id, status, stage, version, snapshot_hash, template_version,
              options, snapshot, worker_id, lease_token::text AS lease_token
       FROM export_job
       WHERE id = $1::uuid`,
      [jobId],
    );
    const row = result.rows[0];
    if (!row?.snapshot) return null;
    assertExportSnapshot(row.snapshot);
    return { job: mapJob(row), snapshot: row.snapshot };
  }
}

export class PostgresExportStageRepository implements ExportStageRepository {
  readonly #database: PostgresExecutor;

  constructor(database: PostgresExecutor) {
    this.#database = database;
  }

  async claim(jobId: string, workerId: string, leaseMs: number): Promise<ClaimedPdfExportJob | null> {
    const result = await this.#database.query<ExportJobRow>(
      `UPDATE export_job
       SET worker_id = $2,
           lease_token = gen_random_uuid(),
           lease_expires_at = now() + ($3::integer * interval '1 millisecond'),
           version = version + 1,
           updated_at = now()
       WHERE id = $1::uuid
         AND status IN ('queued', 'waiting_assets', 'rendering', 'validating', 'cancelling')
         AND (lease_expires_at IS NULL OR lease_expires_at <= now())
       RETURNING id, status, stage, version, snapshot_hash, template_version,
                 options, snapshot, worker_id, lease_token::text AS lease_token`,
      [jobId, workerId, leaseMs],
    );
    const row = result.rows[0];
    return row ? mapClaimedJob(row) : null;
  }

  async advance(
    jobId: string,
    workerId: string,
    leaseToken: string,
    expectedVersion: number,
    from: ExportJobStatus,
    to: ExportJobStatus,
    stage: ExportJobStage,
  ): Promise<PdfExportJob | null> {
    const terminal = ["completed", "completed_with_warnings", "failed", "cancelled"].includes(to);
    const result = await this.#database.query<ExportJobRow>(
      `UPDATE export_job
       SET status = $5,
           stage = $6,
           version = version + 1,
           worker_id = CASE WHEN $7::boolean THEN NULL ELSE worker_id END,
           lease_token = CASE WHEN $7::boolean THEN NULL ELSE lease_token END,
           lease_expires_at = CASE WHEN $7::boolean THEN NULL ELSE lease_expires_at END,
           completed_at = CASE WHEN $7::boolean THEN COALESCE(completed_at, now()) ELSE completed_at END,
           updated_at = now()
       WHERE id = $1::uuid
         AND worker_id = $2
         AND lease_token = $3::uuid
         AND version = $4::integer
         AND status = $8
       RETURNING id, status, stage, version, snapshot_hash, template_version,
                 options, snapshot, worker_id, lease_token::text AS lease_token`,
      [jobId, workerId, leaseToken, expectedVersion, to, stage, terminal, from],
    );
    const row = result.rows[0];
    return row ? mapJob(row) : null;
  }

  async recordArtifact(
    jobId: string,
    workerId: string,
    leaseToken: string,
    expectedVersion: number,
    artifact: Readonly<{ key: string; version: string; checksumSha256: string }>,
  ): Promise<boolean> {
    const result = await this.#database.query(
      `UPDATE export_job
       SET artifact_key = $5,
           artifact_version = $6,
           artifact_checksum_sha256 = $7,
           updated_at = now()
       WHERE id = $1::uuid
         AND worker_id = $2
         AND lease_token = $3::uuid
         AND version = $4::integer
         AND status = 'validating'`,
      [jobId, workerId, leaseToken, expectedVersion, artifact.key, artifact.version, artifact.checksumSha256],
    );
    return result.rowCount === 1;
  }

  async recordMapAsset(
    job: Readonly<{ id: string; workerId?: string; leaseToken?: string; version: number }>,
    asset: Readonly<{ assetId: string; checksumSha256: string; objectVersion: string; width: number; height: number }>,
  ): Promise<boolean> {
    if (!job.workerId || !job.leaseToken) return false;
    const result = await this.#database.query(
      `UPDATE export_job_asset a
       SET checksum_sha256 = $5,
           object_version = $6,
           width = $7,
           height = $8,
           status = 'ready',
           omission_reason = NULL,
           updated_at = now()
       FROM export_job j
       WHERE j.id = $1::uuid
         AND j.worker_id = $2
         AND j.lease_token = $3::uuid
         AND j.version = $4::integer
         AND j.status IN ('waiting_assets', 'rendering', 'validating')
         AND a.export_job_id = j.id
         AND a.asset_id = $9
         AND a.kind = 'map'`,
      [job.id, job.workerId, job.leaseToken, job.version, asset.checksumSha256,
        asset.objectVersion, asset.width, asset.height, asset.assetId],
    );
    return result.rowCount === 1;
  }

  async cancel(jobId: string, workerId: string, leaseToken: string, expectedVersion: number): Promise<boolean> {
    const result = await this.#database.query(
      `UPDATE export_job
       SET status = 'cancelled', stage = 'complete', version = version + 1,
           worker_id = NULL, lease_token = NULL, lease_expires_at = NULL,
           completed_at = COALESCE(completed_at, now()), updated_at = now()
       WHERE id = $1::uuid AND worker_id = $2 AND lease_token = $3::uuid
         AND version = $4::integer AND status = 'cancelling'`,
      [jobId, workerId, leaseToken, expectedVersion],
    );
    return result.rowCount === 1;
  }

  async fail(jobId: string, workerId: string, leaseToken: string, expectedVersion: number, code: string): Promise<boolean> {
    const result = await this.#database.query(
      `UPDATE export_job
       SET status = 'failed', stage = 'complete', error_code = $5,
           version = version + 1, worker_id = NULL, lease_token = NULL,
           lease_expires_at = NULL, completed_at = COALESCE(completed_at, now()),
           updated_at = now()
       WHERE id = $1::uuid AND worker_id = $2 AND lease_token = $3::uuid
         AND version = $4::integer
         AND status NOT IN ('completed', 'completed_with_warnings', 'failed', 'cancelled', 'cancelling')`,
      [jobId, workerId, leaseToken, expectedVersion, code],
    );
    return result.rowCount === 1;
  }
}

export class S3PdfArtifactStore implements PdfArtifactStore {
  readonly #storage: S3ObjectStorage;

  constructor(storage: S3ObjectStorage) {
    this.#storage = storage;
  }

  async put(job: PdfExportJob, pdf: Uint8Array) {
    const objectKey = `derived/${job.id}/pdf-${job.version}-${randomUUID()}`;
    const stored = await this.#storage.putImmutable(
      objectKey,
      Buffer.from(pdf),
      "application/pdf",
    );
    const checksumSha256 = Buffer.from(stored.checksumSha256, "base64").toString("hex");
    return { key: stored.key, version: stored.version, checksumSha256 };
  }

  async delete(artifact: Readonly<{ key: string; version: string }>): Promise<void> {
    await this.#storage.deleteImmutable?.(artifact.key, artifact.version);
  }
}
