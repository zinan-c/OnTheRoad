import { randomUUID } from "node:crypto";

import { ImportUploadError } from "./upload.mjs";

const CONTENT_TYPES = Object.freeze({
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
});

const MAXIMUM_SOURCE_BYTES = 20 * 1024 * 1024;

export class PostgresImportTransport {
  /** @param {{database: any, storage: any, queue?: any, idFactory?: () => string}} options */
  constructor({ database, storage, queue, idFactory = randomUUID }) {
    this.database = database;
    this.storage = storage;
    this.queue = queue;
    this.idFactory = idFactory;
  }

  /** @param {Record<string, any>} request */
  async createUpload(request) {
    const format = validateUploadRequest(request);
    const session = this.storage.createUploadSession({
      ownerId: request.ownerId,
      contentType: request.contentType,
      contentLength: request.contentLength,
      checksumSha256: request.checksumSha256,
    });
    const id = this.idFactory();
    await this.database.query(
      `INSERT INTO attachment (
        id, owner_id, object_key, expected_content_type,
        expected_content_length, expected_checksum_sha256, expires_at,
        purpose, source_filename, trip_id
      ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::timestamptz, 'import_source', $8, $9::uuid)`,
      [id, request.ownerId, session.objectKey, request.contentType,
        request.contentLength, request.checksumSha256, session.expiresAt,
        request.filename, request.tripId],
    );
    return {
      attachmentId: id,
      format,
      uploadUrl: session.uploadUrl,
      headers: session.headers,
      expiresAt: session.expiresAt,
    };
  }

  /** @param {Record<string, unknown>} input */
  async completeUpload(input) {
    const ownerId = String(input.ownerId);
    const attachmentId = String(input.attachmentId);
    const attachment = await this.database.json(
      `SELECT COALESCE((SELECT jsonb_build_object(
        'id', id, 'ownerId', owner_id, 'objectKey', object_key,
        'expectedContentType', expected_content_type,
        'expectedContentLength', expected_content_length,
        'expectedChecksumSha256', expected_checksum_sha256,
        'expiresAt', expires_at, 'status', status, 'version', version
      ) FROM attachment WHERE id = $2::uuid AND owner_id = $1 AND purpose = 'import_source'), 'null'::jsonb)`,
      [ownerId, attachmentId],
    );
    if (!attachment) throw new ImportUploadError("IMPORT_SOURCE_NOT_FOUND", "Import source attachment was not found.", 404);
    if (attachment.status !== "pending") throw new ImportUploadError("UPLOAD_ALREADY_COMPLETED", "The upload session was already completed.", 409);
    if (Date.parse(attachment.expiresAt) < Date.now()) throw new ImportUploadError("UPLOAD_SESSION_EXPIRED", "The upload session expired.", 410);
    const metadata = await this.storage.inspectObject(attachment.objectKey);
    if (metadata.contentType !== attachment.expectedContentType
      || metadata.contentLength !== Number(attachment.expectedContentLength)
      || metadata.checksumSha256 !== attachment.expectedChecksumSha256) {
      throw new ImportUploadError("UPLOADED_OBJECT_MISMATCH", "Uploaded object metadata does not match the signed session.", 409);
    }
    return this.database.json(
      `UPDATE attachment SET status = 'uploaded', object_version = $3,
        checksum_sha256 = $4, content_type = $5, content_length = $6,
        etag = $7, version = version + 1, completed_at = now(), updated_at = now()
       WHERE id = $1::uuid AND owner_id = $2 AND purpose = 'import_source' AND status = 'pending'
       RETURNING jsonb_build_object('id', id, 'status', status, 'version', version,
         'objectKey', object_key, 'objectVersion', object_version,
         'checksumSha256', checksum_sha256, 'contentLength', content_length)`,
      [attachmentId, ownerId, metadata.objectVersion, metadata.checksumSha256,
        metadata.contentType, metadata.contentLength, metadata.etag],
    );
  }

  /** @param {Record<string, unknown>} input */
  async queueInspection(input) {
    const ownerId = String(input.ownerId);
    const attachmentId = String(input.attachmentId);
    const tripId = String(input.tripId);
    const attachment = await this.database.json(
      `SELECT COALESCE((SELECT jsonb_build_object('id', id, 'ownerId', owner_id, 'status', status)
        FROM attachment WHERE id = $2::uuid AND owner_id = $1 AND purpose = 'import_source'), 'null'::jsonb)`,
      [ownerId, attachmentId],
    );
    if (!attachment) throw new ImportUploadError("IMPORT_SOURCE_NOT_FOUND", "Import source attachment was not found.", 404);
    if (!["uploaded", "ready"].includes(attachment.status)) throw new ImportUploadError("ATTACHMENT_NOT_READY", "Import inspection requires the attachment upload gate.", 409);
    const id = this.idFactory();
    await this.database.json(
      `INSERT INTO import_inspect_job (id, owner_id, attachment_id, trip_id)
       VALUES ($1::uuid, $2, $3::uuid, $4::uuid)
       RETURNING jsonb_build_object('id', id, 'ownerId', owner_id, 'attachmentId', attachment_id,
         'status', status, 'attempts', attempts, 'createdAt', created_at, 'updatedAt', updated_at)`,
      [id, ownerId, attachmentId, tripId],
    );
    await this.queue?.lpush("otr:import-inspect", JSON.stringify({ jobId: id }));
    return this.getJob({ ownerId, jobId: id });
  }

  /** @param {Record<string, unknown>} input */
  getJob(input) {
    const ownerId = String(input.ownerId);
    const jobId = String(input.jobId);
    return this.database.json(
      `SELECT COALESCE((SELECT jsonb_build_object('id', id, 'ownerId', owner_id,
        'attachmentId', attachment_id, 'status', status, 'attempts', attempts,
        'inspection', inspection, 'errorCode', error_code, 'errorMessage', error_message,
        'retryable', retryable, 'createdAt', created_at, 'updatedAt', updated_at)
        FROM import_inspect_job WHERE id = $2::uuid AND owner_id = $1), 'null'::jsonb)`,
      [ownerId, jobId],
    ).then((/** @type {any} */ job) => {
      if (!job) throw new ImportUploadError("IMPORT_INSPECT_JOB_NOT_FOUND", "Import inspection job was not found.", 404);
      return job;
    });
  }
}

/** @param {Record<string, any>} request */
function validateUploadRequest(request) {
  if (!request.ownerId?.trim()) throw new ImportUploadError("IMPORT_OWNER_REQUIRED", "Owner is required.");
  const extension = request.filename?.toLowerCase().split(".").pop() ?? "";
  const format = /** @type {keyof typeof CONTENT_TYPES} */ (extension);
  if (!CONTENT_TYPES[format]) throw new ImportUploadError("WORKBOOK_FORMAT_UNSUPPORTED", "Only xlsx, xls, and csv uploads are supported.");
  if (request.contentType !== CONTENT_TYPES[format]) throw new ImportUploadError("WORKBOOK_CONTENT_TYPE_MISMATCH", "Workbook content type does not match the filename.");
  if (!Number.isSafeInteger(request.contentLength) || request.contentLength < 1 || request.contentLength > MAXIMUM_SOURCE_BYTES) throw new ImportUploadError("WORKBOOK_SIZE_LIMIT", "Workbook upload size is outside the allowed range.");
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(request.checksumSha256 ?? "")) throw new ImportUploadError("WORKBOOK_CHECKSUM_INVALID", "Workbook checksum must be SHA-256 base64.");
  return format;
}
