import {
  assertExportJobTransition,
  type ExportJobStage,
  type ExportJobStatus,
} from "@on-the-road/application/export";

export type PdfExportJob = Readonly<{
  id: string;
  status: ExportJobStatus;
  stage: ExportJobStage;
  version: number;
  snapshotHash: string;
  templateVersion: string;
}>;

export type ClaimedPdfExportJob = PdfExportJob & Readonly<{ leaseToken: string }>;

export type ExportStageRepository = Readonly<{
  claim(jobId: string, workerId: string, leaseMs: number): Promise<ClaimedPdfExportJob | null>;
  advance(jobId: string, workerId: string, leaseToken: string, expectedVersion: number, from: ExportJobStatus, to: ExportJobStatus, stage: ExportJobStage): Promise<PdfExportJob | null>;
  cancel(jobId: string, workerId: string, leaseToken: string, expectedVersion: number): Promise<boolean>;
  fail(jobId: string, workerId: string, leaseToken: string, expectedVersion: number, code: string): Promise<boolean>;
}>;

export class PdfExportStageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PdfExportStageError";
    this.code = code;
  }
}

export function assertStageTransition(
  from: ExportJobStatus,
  to: ExportJobStatus,
): void {
  try {
    assertExportJobTransition(from, to);
  } catch (error) {
    throw new PdfExportStageError(
      "PDF_INVALID_STAGE_TRANSITION",
      error instanceof Error ? error.message : "Invalid PDF export stage transition",
    );
  }
}

export class InMemoryExportStageRepository implements ExportStageRepository {
  readonly #jobs = new Map<string, PdfExportJob>();
  readonly #leases = new Map<string, { workerId: string; token: string; expiresAt: number }>();

  seed(job: PdfExportJob): void { this.#jobs.set(job.id, job); }
  get(jobId: string): PdfExportJob | undefined { return this.#jobs.get(jobId); }

  async claim(jobId: string, workerId: string, leaseMs: number): Promise<ClaimedPdfExportJob | null> {
    const job = this.#jobs.get(jobId);
    if (!job || !["queued", "waiting_assets", "rendering", "validating", "cancelling"].includes(job.status)) return null;
    const current = this.#leases.get(jobId);
    if (current && current.expiresAt > Date.now()) return null;
    const token = `${workerId}:${job.version + 1}`;
    this.#leases.set(jobId, { workerId, token, expiresAt: Date.now() + leaseMs });
    return { ...job, leaseToken: token };
  }

  leaseToken(jobId: string): string | null { return this.#leases.get(jobId)?.token ?? null; }

  async advance(jobId: string, workerId: string, leaseToken: string, expectedVersion: number, from: ExportJobStatus, to: ExportJobStatus, stage: ExportJobStage): Promise<PdfExportJob | null> {
    const job = this.#jobs.get(jobId);
    const lease = this.#leases.get(jobId);
    if (!job || !lease || lease.workerId !== workerId || lease.token !== leaseToken || lease.expiresAt <= Date.now() || job.version !== expectedVersion || job.status !== from) return null;
    assertStageTransition(from, to);
    const next: PdfExportJob = { ...job, status: to, stage, version: job.version + 1 };
    this.#jobs.set(jobId, next);
    return { ...next, leaseToken: lease.token } as ClaimedPdfExportJob;
  }

  async cancel(jobId: string, workerId: string, leaseToken: string, expectedVersion: number): Promise<boolean> {
    const job = this.#jobs.get(jobId);
    const lease = this.#leases.get(jobId);
    if (!job || !lease || lease.workerId !== workerId || lease.token !== leaseToken || job.version !== expectedVersion || job.status !== "cancelling") return false;
    this.#jobs.set(jobId, { ...job, status: "cancelled", stage: "complete", version: job.version + 1 });
    return true;
  }

  async fail(jobId: string, workerId: string, leaseToken: string, expectedVersion: number, code: string): Promise<boolean> {
    const job = this.#jobs.get(jobId);
    const lease = this.#leases.get(jobId);
    if (!job || !lease || lease.workerId !== workerId || lease.token !== leaseToken || job.version !== expectedVersion || ["completed", "completed_with_warnings", "failed", "cancelled"].includes(job.status)) return false;
    this.#jobs.set(jobId, { ...job, status: "failed", stage: "complete", version: job.version + 1 });
    void code;
    return true;
  }
}
