// @ts-nocheck -- runtime contract is covered by upload-to-inspect tests.
import { createHash, randomUUID } from "node:crypto";

const MAXIMUM_SOURCE_BYTES = 20 * 1024 * 1024;
const CONTENT_TYPES = Object.freeze({
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
});

export class ImportUploadError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ImportUploadError";
    this.code = code;
    this.status = status;
    this.retryable = false;
  }
}

export class ImportUploadService {
  constructor({ store, idFactory = randomUUID }) {
    this.store = store;
    this.idFactory = idFactory;
  }

  createUpload(request) {
    const format = validateUploadRequest(request);
    return this.store.createAttachment({
      id: this.idFactory(),
      ownerId: request.ownerId,
      filename: request.filename,
      contentType: request.contentType,
      contentLength: request.contentLength,
      checksumSha256: request.checksumSha256,
      format,
    });
  }

  queueInspection({ ownerId, attachmentId }) {
    const attachment = this.store.getAttachment(attachmentId);
    if (attachment.ownerId !== ownerId) {
      throw new ImportUploadError(
        "IMPORT_SOURCE_NOT_FOUND",
        "Import source attachment was not found.",
        404,
      );
    }
    if (attachment.status !== "ready") {
      throw new ImportUploadError(
        "ATTACHMENT_NOT_READY",
        "Import inspection requires the attachment ready gate.",
        409,
      );
    }
    return this.store.createJob({
      id: this.idFactory(),
      ownerId,
      attachmentId,
    });
  }

  getJob({ ownerId, jobId }) {
    const job = this.store.getJob(jobId);
    if (job.ownerId !== ownerId) {
      throw new ImportUploadError(
        "IMPORT_INSPECT_JOB_NOT_FOUND",
        "Import inspection job was not found.",
        404,
      );
    }
    return job;
  }
}

export class ImportAuditStore {
  #attachments = new Map();
  #jobs = new Map();
  #objects = new Map();

  createAttachment(input) {
    const attachment = {
      ...structuredClone(input),
      status: "pending",
      objectKey: `imports/${input.id}/source`,
      version: 1,
    };
    this.#attachments.set(attachment.id, attachment);
    return structuredClone(attachment);
  }

  upload(attachmentId, body) {
    const attachment = this.#requireAttachment(attachmentId);
    if (attachment.status !== "pending") {
      throw new ImportUploadError(
        "IMPORT_SOURCE_ALREADY_UPLOADED",
        "Import source object is append-only.",
        409,
      );
    }
    if (body.byteLength !== attachment.contentLength) {
      throw new ImportUploadError(
        "IMPORT_SOURCE_LENGTH_MISMATCH",
        "Uploaded source length does not match the session.",
      );
    }
    if (checksum(body) !== attachment.checksumSha256) {
      throw new ImportUploadError(
        "IMPORT_SOURCE_CHECKSUM_MISMATCH",
        "Uploaded source checksum does not match the session.",
      );
    }
    attachment.status = "uploaded";
    attachment.objectVersion = checksum(body);
    attachment.version += 1;
    this.#objects.set(
      objectIdentity(attachment.objectKey, attachment.objectVersion),
      Buffer.from(body),
    );
    return structuredClone(attachment);
  }

  recordCleanScan(attachmentId, evidence) {
    const attachment = this.#requireAttachment(attachmentId);
    if (attachment.status !== "uploaded") {
      throw new ImportUploadError(
        "IMPORT_SOURCE_NOT_SCANNED",
        "Only a scanned uploaded source can become ready.",
        409,
      );
    }
    if (
      !evidence?.scanner?.trim()
      || evidence.objectVersion !== attachment.objectVersion
      || evidence.checksumSha256 !== attachment.checksumSha256
      || !Number.isFinite(Date.parse(evidence.scannedAt))
      || evidence.expectedVersion !== attachment.version
    ) {
      throw new ImportUploadError(
        "IMPORT_SCAN_EVIDENCE_INVALID",
        "Clean scan evidence must bind the immutable source version and checksum.",
        409,
      );
    }
    attachment.status = "ready";
    attachment.scanEngine = evidence.scanner;
    attachment.scanCompletedAt = evidence.scannedAt;
    attachment.version += 1;
    return structuredClone(attachment);
  }

  markAttachmentFailed(attachmentId, errorCode) {
    const attachment = this.#requireAttachment(attachmentId);
    if (attachment.status !== "uploaded") {
      throw new ImportUploadError(
        "IMPORT_SOURCE_NOT_UPLOADED",
        "Only an uploaded source can fail scanning.",
        409,
      );
    }
    attachment.status = "failed";
    attachment.processingErrorCode = errorCode;
    attachment.version += 1;
    return structuredClone(attachment);
  }

  createJob({ id, ownerId, attachmentId }) {
    const job = {
      id,
      ownerId,
      attachmentId,
      status: "queued",
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.#jobs.set(id, job);
    return structuredClone(job);
  }

  claimJob(id) {
    const job = this.#requireJob(id);
    if (job.status !== "queued") {
      throw new ImportUploadError(
        "IMPORT_INSPECT_JOB_NOT_QUEUED",
        "Import inspection job is not queued.",
        409,
      );
    }
    job.status = "processing";
    job.attempts += 1;
    job.updatedAt = new Date().toISOString();
    return structuredClone(job);
  }

  getAttachment(id) {
    return structuredClone(this.#requireAttachment(id));
  }

  getJob(id) {
    return structuredClone(this.#requireJob(id));
  }

  markSucceeded(id, inspection) {
    const job = this.#requireJob(id);
    job.status = "succeeded";
    job.inspection = structuredClone(inspection);
    job.updatedAt = new Date().toISOString();
    delete job.errorCode;
    delete job.errorMessage;
    delete job.retryable;
    return structuredClone(job);
  }

  markFailed(id, error) {
    const job = this.#requireJob(id);
    job.status = "failed";
    job.errorCode = error.code;
    job.errorMessage = error.message;
    job.retryable = error.retryable;
    job.updatedAt = new Date().toISOString();
    return structuredClone(job);
  }

  async readImmutable(objectKey, objectVersion) {
    const body = this.#objects.get(objectIdentity(objectKey, objectVersion));
    if (!body) {
      throw new ImportUploadError(
        "IMPORT_SOURCE_OBJECT_MISSING",
        "Immutable import source object was not found.",
        404,
      );
    }
    return Buffer.from(body);
  }

  #requireAttachment(id) {
    const attachment = this.#attachments.get(id);
    if (!attachment) {
      throw new ImportUploadError(
        "IMPORT_SOURCE_NOT_FOUND",
        "Import source attachment was not found.",
        404,
      );
    }
    return attachment;
  }

  #requireJob(id) {
    const job = this.#jobs.get(id);
    if (!job) {
      throw new ImportUploadError(
        "IMPORT_INSPECT_JOB_NOT_FOUND",
        "Import inspection job was not found.",
        404,
      );
    }
    return job;
  }
}

function validateUploadRequest(request) {
  if (!request.ownerId?.trim()) {
    throw new ImportUploadError("IMPORT_OWNER_REQUIRED", "Owner is required.");
  }
  const extension = request.filename?.toLocaleLowerCase("en-US").split(".").pop();
  if (!CONTENT_TYPES[extension]) {
    throw new ImportUploadError(
      "WORKBOOK_FORMAT_UNSUPPORTED",
      "Only xlsx, xls, and csv uploads are supported.",
    );
  }
  if (request.contentType !== CONTENT_TYPES[extension]) {
    throw new ImportUploadError(
      "WORKBOOK_CONTENT_TYPE_MISMATCH",
      "Workbook content type does not match the filename.",
    );
  }
  if (
    !Number.isSafeInteger(request.contentLength)
    || request.contentLength < 1
    || request.contentLength > MAXIMUM_SOURCE_BYTES
  ) {
    throw new ImportUploadError(
      "WORKBOOK_SIZE_LIMIT",
      "Workbook upload size is outside the allowed range.",
    );
  }
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(request.checksumSha256)) {
    throw new ImportUploadError(
      "WORKBOOK_CHECKSUM_INVALID",
      "Workbook checksum must be SHA-256 base64.",
    );
  }
  return extension;
}

function checksum(body) {
  return createHash("sha256").update(body).digest("base64");
}

function objectIdentity(key, version) {
  return `${key}\u0000${version}`;
}
