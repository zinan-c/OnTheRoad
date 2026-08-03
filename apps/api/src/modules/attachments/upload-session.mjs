import { randomUUID } from "node:crypto";

export class AttachmentUploadError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] */
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AttachmentUploadError";
    this.code = code;
    this.status = status;
  }
}

export class InMemoryAttachmentRepository {
  /** @type {Map<string, Record<string, any>>} */
  #attachments = new Map();

  /** @param {{id: string} & Record<string, any>} attachment */
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

  /** @param {string} id */
  findById(id) {
    const attachment = this.#attachments.get(id);
    return attachment ? { ...attachment } : undefined;
  }

  /** @param {string} id @param {number} expectedVersion @param {Record<string, any>} metadata */
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

  /** @param {string} ownerId @param {string} id */
  retry(ownerId, id) {
    const attachment = this.#attachments.get(id);
    if (!attachment || attachment.ownerId !== ownerId) {
      throw new AttachmentUploadError("ATTACHMENT_NOT_FOUND", "Attachment was not found.", 404);
    }
    if (attachment.status !== "failed") {
      throw new AttachmentUploadError("MEDIA_NOT_RETRYABLE", "Attachment is not retryable.", 409);
    }
    const retried = {
      ...attachment,
      status: "uploaded",
      processingErrorCode: null,
      version: attachment.version + 1,
    };
    this.#attachments.set(id, retried);
    return { ...retried };
  }
}

export class AttachmentUploadService {
  /** @type {any} */
  #storage;
  /** @type {any} */
  #repository;
  /** @type {() => Date} */
  #clock;
  /** @type {() => string} */
  #idFactory;
  /** @type {{lpush: (key: string, value: string) => Promise<unknown>} | undefined} */
  #queue;

  /** @param {{storage: any, repository: any, queue?: any, clock?: () => Date, idFactory?: () => string}} options */
  constructor({ storage, repository, queue, clock = () => new Date(), idFactory = randomUUID }) {
    this.#storage = storage;
    this.#repository = repository;
    this.#clock = clock;
    this.#idFactory = idFactory;
    this.#queue = queue;
  }

  /** @param {{ownerId: string, tripId?: string, itemId?: string, contentType: string, contentLength: number, checksumSha256: string}} input */
  async createSession({ ownerId, tripId, itemId, contentType, contentLength, checksumSha256 }) {
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
      ...(tripId ? { tripId } : {}),
      ...(itemId ? { itemId } : {}),
    });
    return {
      attachmentId: attachment.id,
      ...storageSession,
    };
  }

  /** @param {{ownerId: string, attachmentId: string}} input */
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
    const completed = await this.#repository.complete(attachment.id, attachment.version, {
      ...metadata,
      ownerId,
    });
    await this.#queue?.lpush("otr:media", JSON.stringify({ attachmentId }));
    return completed;
  }

  /** @param {{ownerId: string, attachmentId: string}} input */
  async retry({ ownerId, attachmentId }) {
    const retried = await this.#repository.retry(ownerId, attachmentId);
    await this.#queue?.lpush("otr:media", JSON.stringify({ attachmentId }));
    return retried;
  }

  /** @param {{ownerId: string, attachmentId: string}} input */
  async get({ ownerId, attachmentId }) {
    return this.#ownedAttachment(ownerId, attachmentId);
  }

  /** @param {string} ownerId @param {string} attachmentId */
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
