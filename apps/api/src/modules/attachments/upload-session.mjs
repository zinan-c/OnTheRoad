// @ts-nocheck
import { randomUUID } from "node:crypto";

export class AttachmentUploadError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AttachmentUploadError";
    this.code = code;
    this.status = status;
  }
}

export class InMemoryAttachmentRepository {
  #attachments = new Map();

  insertPending(attachment) {
    if (this.#attachments.has(attachment.id)) {
      throw new AttachmentUploadError(
        "ATTACHMENT_ALREADY_EXISTS",
        "Attachment already exists.",
        409,
      );
    }
    this.#attachments.set(attachment.id, { ...attachment });
    return { ...attachment };
  }

  findById(id) {
    const attachment = this.#attachments.get(id);
    return attachment ? { ...attachment } : undefined;
  }

  complete(id, expectedVersion, metadata) {
    const attachment = this.#attachments.get(id);
    if (!attachment || attachment.version !== expectedVersion) {
      throw new AttachmentUploadError(
        "ATTACHMENT_VERSION_CONFLICT",
        "Attachment changed while the upload was completing.",
        409,
      );
    }
    if (attachment.status !== "pending") {
      throw new AttachmentUploadError(
        "UPLOAD_ALREADY_COMPLETED",
        "The upload session was already completed.",
        409,
      );
    }
    const completed = {
      ...attachment,
      ...metadata,
      status: "uploaded",
      version: attachment.version + 1,
    };
    this.#attachments.set(id, completed);
    return { ...completed };
  }
}

export class AttachmentUploadService {
  #storage;
  #repository;
  #clock;
  #idFactory;

  constructor({ storage, repository, clock = () => new Date(), idFactory = randomUUID }) {
    this.#storage = storage;
    this.#repository = repository;
    this.#clock = clock;
    this.#idFactory = idFactory;
  }

  async createSession({ ownerId, contentType, contentLength, checksumSha256 }) {
    if (!ownerId?.trim()) {
      throw new AttachmentUploadError("OWNER_REQUIRED", "An owner is required.");
    }
    const storageSession = this.#storage.createUploadSession({
      ownerId,
      contentType,
      contentLength,
      checksumSha256,
    });
    const attachment = await this.#repository.insertPending({
      id: this.#idFactory(),
      ownerId,
      objectKey: storageSession.objectKey,
      expectedContentType: contentType,
      expectedContentLength: contentLength,
      expectedChecksumSha256: checksumSha256,
      expiresAt: storageSession.expiresAt,
      status: "pending",
      version: 1,
    });
    return {
      attachmentId: attachment.id,
      ...storageSession,
    };
  }

  async complete({ ownerId, attachmentId }) {
    const attachment = await this.#ownedAttachment(ownerId, attachmentId);
    if (attachment.status !== "pending") {
      throw new AttachmentUploadError(
        "UPLOAD_ALREADY_COMPLETED",
        "The upload session was already completed.",
        409,
      );
    }
    if (Date.parse(attachment.expiresAt) < this.#clock().getTime()) {
      throw new AttachmentUploadError(
        "UPLOAD_SESSION_EXPIRED",
        "The upload session expired.",
        410,
      );
    }
    const metadata = await this.#storage.inspectObject(attachment.objectKey);
    if (
      metadata.contentType !== attachment.expectedContentType
      || metadata.contentLength !== attachment.expectedContentLength
      || metadata.checksumSha256 !== attachment.expectedChecksumSha256
    ) {
      throw new AttachmentUploadError(
        "UPLOADED_OBJECT_MISMATCH",
        "Uploaded object metadata does not match the signed session.",
        409,
      );
    }
    return this.#repository.complete(attachment.id, attachment.version, {
      ...metadata,
      ownerId,
    });
  }

  async get({ ownerId, attachmentId }) {
    return this.#ownedAttachment(ownerId, attachmentId);
  }

  async #ownedAttachment(ownerId, attachmentId) {
    const attachment = await this.#repository.findById(attachmentId);
    if (!attachment || attachment.ownerId !== ownerId) {
      throw new AttachmentUploadError(
        "ATTACHMENT_NOT_FOUND",
        "Attachment was not found.",
        404,
      );
    }
    return attachment;
  }
}
