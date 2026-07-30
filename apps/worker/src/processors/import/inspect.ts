export type ImportSourceAttachment = {
  id: string;
  ownerId: string;
  status: "pending" | "uploaded" | "processing" | "ready" | "failed";
  filename: string;
  objectKey?: string;
  objectVersion?: string;
  checksumSha256?: string;
  contentLength?: number;
  scanEngine?: string;
  scanCompletedAt?: string;
  version: number;
};

export type WorkbookInspection = {
  format: "xlsx" | "xls" | "csv";
  sheets: Array<{
    name: string;
    columns: string[];
    samples: Array<Record<string, unknown>>;
    rowCount: number;
  }>;
};

export type ImportInspectJob = {
  id: string;
  ownerId: string;
  attachmentId: string;
  status: "queued" | "processing" | "succeeded" | "failed";
  attempts: number;
  inspection?: WorkbookInspection;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
};

export class ImportInspectError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ImportInspectError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface ImportInspectRepository {
  claimJob(id: string): ImportInspectJob | Promise<ImportInspectJob>;
  getAttachment(id: string): ImportSourceAttachment | Promise<ImportSourceAttachment>;
  markSucceeded(
    id: string,
    inspection: WorkbookInspection,
  ): ImportInspectJob | Promise<ImportInspectJob>;
  markFailed(
    id: string,
    error: Pick<ImportInspectError, "code" | "message" | "retryable">,
  ): ImportInspectJob | Promise<ImportInspectJob>;
}

type ImportInspectProcessorOptions = {
  repository: ImportInspectRepository;
  storage: {
    readImmutable: (objectKey: string, objectVersion: string) => Promise<Buffer>;
  };
  inspect: (
    body: Buffer,
    options: { filename: string },
  ) => WorkbookInspection | Promise<WorkbookInspection>;
};

export class ImportInspectProcessor {
  readonly #repository: ImportInspectRepository;
  readonly #storage: ImportInspectProcessorOptions["storage"];
  readonly #inspect: ImportInspectProcessorOptions["inspect"];

  constructor(options: ImportInspectProcessorOptions) {
    this.#repository = options.repository;
    this.#storage = options.storage;
    this.#inspect = options.inspect;
  }

  async process(jobId: string): Promise<ImportInspectJob> {
    const job = await this.#repository.claimJob(jobId);
    try {
      const attachment = await this.#repository.getAttachment(job.attachmentId);
      assertReadyAttachment(job, attachment);
      const body = await this.#storage.readImmutable(
        attachment.objectKey!,
        attachment.objectVersion!,
      );
      if (
        attachment.contentLength !== undefined
        && body.byteLength !== attachment.contentLength
      ) {
        throw new ImportInspectError(
          "ATTACHMENT_CONTENT_CHANGED",
          "Attachment length does not match immutable metadata.",
        );
      }
      const inspection = await this.#inspect(body, {
        filename: attachment.filename,
      });
      return await this.#repository.markSucceeded(job.id, inspection);
    } catch (error) {
      const failure = asInspectError(error);
      await this.#repository.markFailed(job.id, failure);
      throw failure;
    }
  }
}

export class InMemoryImportInspectRepository implements ImportInspectRepository {
  readonly #attachments: Map<string, ImportSourceAttachment>;
  readonly #jobs: Map<string, ImportInspectJob>;

  constructor(seed: {
    attachments?: ImportSourceAttachment[];
    jobs?: ImportInspectJob[];
  } = {}) {
    this.#attachments = new Map(
      (seed.attachments ?? []).map((attachment) => [
        attachment.id,
        structuredClone(attachment),
      ]),
    );
    this.#jobs = new Map(
      (seed.jobs ?? []).map((job) => [job.id, structuredClone(job)]),
    );
  }

  claimJob(id: string): ImportInspectJob {
    const job = this.requireJob(id);
    if (job.status !== "queued") {
      throw new ImportInspectError(
        "IMPORT_INSPECT_JOB_NOT_QUEUED",
        "Import inspection job is not queued.",
      );
    }
    job.status = "processing";
    job.attempts += 1;
    return structuredClone(job);
  }

  getAttachment(id: string): ImportSourceAttachment {
    const attachment = this.#attachments.get(id);
    if (!attachment) {
      throw new ImportInspectError(
        "ATTACHMENT_NOT_FOUND",
        "Import source attachment was not found.",
      );
    }
    return structuredClone(attachment);
  }

  markSucceeded(id: string, inspection: WorkbookInspection): ImportInspectJob {
    const job = this.requireJob(id);
    job.status = "succeeded";
    job.inspection = structuredClone(inspection);
    delete job.errorCode;
    delete job.errorMessage;
    delete job.retryable;
    return structuredClone(job);
  }

  markFailed(
    id: string,
    error: Pick<ImportInspectError, "code" | "message" | "retryable">,
  ): ImportInspectJob {
    const job = this.requireJob(id);
    job.status = "failed";
    job.errorCode = error.code;
    job.errorMessage = error.message;
    job.retryable = error.retryable;
    return structuredClone(job);
  }

  getJob(id: string): ImportInspectJob {
    return structuredClone(this.requireJob(id));
  }

  private requireJob(id: string): ImportInspectJob {
    const job = this.#jobs.get(id);
    if (!job) {
      throw new ImportInspectError(
        "IMPORT_INSPECT_JOB_NOT_FOUND",
        "Import inspection job was not found.",
      );
    }
    return job;
  }
}

function assertReadyAttachment(
  job: ImportInspectJob,
  attachment: ImportSourceAttachment,
): asserts attachment is ImportSourceAttachment & {
  status: "ready";
  objectKey: string;
  objectVersion: string;
  checksumSha256: string;
  contentLength: number;
} {
  if (attachment.ownerId !== job.ownerId) {
    throw new ImportInspectError(
      "ATTACHMENT_OWNER_MISMATCH",
      "Import source attachment does not belong to the job owner.",
    );
  }
  if (
    attachment.status !== "ready"
    || !attachment.objectKey
    || !attachment.objectVersion
    || !attachment.checksumSha256
    || !Number.isSafeInteger(attachment.contentLength)
    || !attachment.scanEngine
    || !attachment.scanCompletedAt
  ) {
    throw new ImportInspectError(
      "ATTACHMENT_NOT_READY",
      "Import inspection requires a ready immutable attachment.",
    );
  }
}

function asInspectError(error: unknown): ImportInspectError {
  if (
    error instanceof Error
    && "code" in error
    && typeof error.code === "string"
  ) {
    return new ImportInspectError(
      error.code,
      error.message,
      "retryable" in error && error.retryable === true,
      error,
    );
  }
  return new ImportInspectError(
    "WORKBOOK_INSPECT_INTERNAL",
    "Workbook inspection failed unexpectedly.",
    true,
    error,
  );
}
