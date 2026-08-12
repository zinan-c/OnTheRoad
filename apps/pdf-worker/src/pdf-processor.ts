import { randomUUID } from "node:crypto";

import type { ExportSnapshot } from "@on-the-road/application/export";
import { waitForPrintResources, type PrintResourceProbe } from "./resource-barrier.js";
import type { ExportStageRepository, PdfExportJob } from "./export-stage-machine.js";

export interface PdfPrintRenderer {
  render(input: Readonly<{
    job: PdfExportJob;
    snapshot: ExportSnapshot;
    signal: AbortSignal;
  }>): Promise<Uint8Array>;
  cleanup?(jobId: string): Promise<void>;
  finalize?(jobId: string): Promise<void>;
}

export interface PdfArtifactStore {
  put(job: PdfExportJob, pdf: Uint8Array): Promise<Readonly<{ key: string; version: string; checksumSha256: string }>>;
  delete?(artifact: Readonly<{ key: string; version: string }>): Promise<void>;
}

export interface PdfExportJobSource {
  get(jobId: string): Promise<Readonly<{ job: PdfExportJob; snapshot: ExportSnapshot }> | null>;
}

export class PdfProcessorError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "PdfProcessorError";
    this.code = code;
    this.retryable = retryable;
  }
}

function assertPdf(pdf: Uint8Array): void {
  const header = new TextDecoder().decode(pdf.subarray(0, 5));
  if (header !== "%PDF-" || pdf.byteLength < 20) {
    throw new PdfProcessorError("PDF_VALIDATION_FAILED", "The renderer did not return a valid PDF payload.");
  }
}

export class PdfExportProcessor {
  readonly #source: PdfExportJobSource;
  readonly #stages: ExportStageRepository;
  readonly #renderer: PdfPrintRenderer;
  readonly #artifacts: PdfArtifactStore;
  readonly #probeFactory: (job: PdfExportJob, snapshot: ExportSnapshot) => PrintResourceProbe;
  readonly #workerId: string;
  readonly #resourceTimeoutMs: number;

  constructor(options: {
    source: PdfExportJobSource;
    stages: ExportStageRepository;
    renderer: PdfPrintRenderer;
    artifacts: PdfArtifactStore;
    probeFactory: (job: PdfExportJob, snapshot: ExportSnapshot) => PrintResourceProbe;
    workerId?: string;
    resourceTimeoutMs?: number;
  }) {
    this.#source = options.source;
    this.#stages = options.stages;
    this.#renderer = options.renderer;
    this.#artifacts = options.artifacts;
    this.#probeFactory = options.probeFactory;
    this.#workerId = options.workerId ?? randomUUID();
    this.#resourceTimeoutMs = options.resourceTimeoutMs ?? 15_000;
  }

  async process(jobId: string, externalSignal?: AbortSignal): Promise<"completed" | "cancelled" | "failed" | "fenced"> {
    const source = await this.#source.get(jobId);
    if (!source) throw new PdfProcessorError("PDF_JOB_NOT_FOUND", "Export job was not found.");
    const claimed = await this.#stages.claim(jobId, this.#workerId, 60_000);
    if (!claimed) return "fenced";
    const leaseToken = claimed.leaseToken;
    let current: PdfExportJob = claimed;
    let artifact: { key: string; version: string; checksumSha256: string } | undefined;
    const controller = new AbortController();
    const abort = () => controller.abort();
    externalSignal?.addEventListener("abort", abort, { once: true });
    try {
      if (current.status === "cancelling") {
        return await this.#stages.cancel(jobId, this.#workerId, leaseToken, current.version) ? "cancelled" : "fenced";
      }
      if (["rendering", "validating"].includes(current.status)) {
        // Reconciliation may re-deliver an already claimed stage. The same
        // lease can safely resume from that persisted stage.
      }
      if (current.status === "queued") {
        current = await this.#mustAdvance(current, leaseToken, "waiting_assets", "assets");
      }
      await waitForPrintResources(this.#probeFactory(current, source.snapshot), { timeoutMs: this.#resourceTimeoutMs, signal: controller.signal });
      if (current.status === "waiting_assets") {
        current = await this.#mustAdvance(current, leaseToken, "rendering", "render");
      }
      const pdf = await this.#renderer.render({ job: current, snapshot: source.snapshot, signal: controller.signal });
      assertPdf(pdf);
      if (current.status !== "validating") {
        current = await this.#mustAdvance(current, leaseToken, "validating", "validate");
      }
      artifact = await this.#artifacts.put(current, pdf);
      if (this.#stages.recordArtifact
        && !await this.#stages.recordArtifact(
          jobId,
          this.#workerId,
          leaseToken,
          current.version,
          artifact,
        )) {
        throw new PdfProcessorError("PDF_ARTIFACT_FENCED", "The export artifact was superseded before completion.");
      }
      current = await this.#mustAdvance(current, leaseToken, "completed", "complete");
      await this.#renderer.finalize?.(jobId);
      void current;
      return "completed";
    } catch (error) {
      const errorCode = error instanceof PdfProcessorError
        ? error.code
        : error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code
          : error instanceof Error && error.message === "PDF_RENDER_CANCELLED"
            ? "PDF_RENDER_CANCELLED"
            : null;
      if (errorCode === "PDF_RENDER_CANCELLED") {
        await this.#renderer.cleanup?.(jobId).catch(() => undefined);
        return await this.#stages.cancel(jobId, this.#workerId, leaseToken, current.version) ? "cancelled" : "fenced";
      }
      await this.#renderer.cleanup?.(jobId).catch(() => undefined);
      if (artifact && this.#artifacts.delete) await this.#artifacts.delete(artifact);
      if (await this.#stages.cancel(jobId, this.#workerId, leaseToken, current.version)) {
        return "cancelled";
      }
      const failed = await this.#stages.fail(jobId, this.#workerId, leaseToken, current.version, errorCode ?? "PDF_RENDER_FAILED");
      if (!failed) return "fenced";
      throw error;
    } finally {
      controller.abort();
      externalSignal?.removeEventListener("abort", abort);
    }
  }

  async #mustAdvance(job: PdfExportJob, leaseToken: string, status: PdfExportJob["status"], stage: PdfExportJob["stage"]): Promise<PdfExportJob> {
    const next = await this.#stages.advance(this.#sourceId(job), this.#workerId, leaseToken, job.version, job.status, status, stage);
    if (!next) throw new PdfProcessorError("PDF_STAGE_FENCED", "The export stage was changed by another worker.");
    return next;
  }

  #sourceId(job: PdfExportJob): string { return job.id; }
}
