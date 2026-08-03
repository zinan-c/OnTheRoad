export class AttachmentGalleryError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] */
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AttachmentGalleryError";
    this.code = code;
    this.status = status;
  }
}

/** @param {any} value */
function clone(value) {
  return structuredClone(value);
}

export class InMemoryAttachmentGalleryRepository {
  /** @param {Record<string, any>[]} [attachments] */
  constructor(attachments = []) {
    this.attachments = new Map(attachments.map((attachment) => [attachment.id, clone(attachment)]));
  }

  /** @param {string} ownerId @param {string} itemId */
  list(ownerId, itemId) {
    return [...this.attachments.values()]
      .filter((attachment) => attachment.ownerId === ownerId && attachment.itemId === itemId && !attachment.deletedAt)
      .sort((left, right) => (left.sortOrder - right.sortOrder) || left.id.localeCompare(right.id))
      .map(clone);
  }

  /** @param {string} ownerId @param {string} id @param {number} expectedVersion @param {Record<string, any>} patch */
  update(ownerId, id, expectedVersion, patch) {
    const attachment = this.#owned(ownerId, id);
    if (attachment.version !== expectedVersion) throw new AttachmentGalleryError("ATTACHMENT_VERSION_CONFLICT", "Attachment changed.", 409);
    Object.assign(attachment, patch, { version: attachment.version + 1, updatedAt: new Date().toISOString() });
    return clone(attachment);
  }

  /** @param {string} ownerId @param {string} itemId @param {number | Record<string, number>} expectedVersion @param {string[]} orderedIds */
  reorder(ownerId, itemId, expectedVersion, orderedIds) {
    const current = this.list(ownerId, itemId);
    if (current.length !== orderedIds.length || new Set(orderedIds).size !== orderedIds.length || !current.every(({ id }) => orderedIds.includes(id))) {
      throw new AttachmentGalleryError("ATTACHMENT_ORDER_INCOMPLETE", "Order must include every visible attachment.");
    }
    if (current.some(({ id, version }) =>
      version !== (typeof expectedVersion === "number"
        ? expectedVersion
        : expectedVersion[id]))) {
      throw new AttachmentGalleryError("ATTACHMENT_VERSION_CONFLICT", "Gallery changed.", 409);
    }
    for (const [sortOrder, id] of orderedIds.entries()) this.#owned(ownerId, id).sortOrder = sortOrder;
    for (const id of orderedIds) this.#owned(ownerId, id).version += 1;
    return this.list(ownerId, itemId);
  }

  /** @param {string} ownerId @param {string} id */
  remove(ownerId, id) {
    const attachment = this.#owned(ownerId, id);
    if (attachment.referenced) throw new AttachmentGalleryError("ATTACHMENT_STILL_REFERENCED", "Attachment is still referenced.", 409);
    attachment.deletedAt = new Date().toISOString();
    attachment.version += 1;
    return clone(attachment);
  }

  /** @param {string} ownerId @param {string} id */
  #owned(ownerId, id) {
    const attachment = this.attachments.get(id);
    if (!attachment || attachment.ownerId !== ownerId) throw new AttachmentGalleryError("ATTACHMENT_NOT_FOUND", "Attachment was not found.", 404);
    return attachment;
  }
}

export class AttachmentGalleryService {
  /** @param {any} repository */
  constructor(repository) { this.repository = repository; }

  /** @param {string} ownerId @param {string} itemId */
  list(ownerId, itemId) { return this.repository.list(ownerId, itemId); }
  /** @param {string} ownerId @param {string} id @param {number} expectedVersion @param {Record<string, any>} patch */
  update(ownerId, id, expectedVersion, patch) {
    const caption = patch.caption === undefined ? undefined : String(patch.caption).trim();
    if (caption !== undefined && caption.length > 2000) throw new AttachmentGalleryError("CAPTION_TOO_LONG", "Caption is too long.");
    return this.repository.update(ownerId, id, expectedVersion, {
      ...(caption === undefined ? {} : { caption }),
      ...(patch.isCover === undefined ? {} : { isCover: Boolean(patch.isCover) }),
      ...(patch.sortOrder === undefined ? {} : { sortOrder: Number(patch.sortOrder) }),
    });
  }
  /** @param {string} ownerId @param {string} itemId @param {number | Record<string, number>} expectedVersion @param {string[]} orderedIds */
  reorder(ownerId, itemId, expectedVersion, orderedIds) { return this.repository.reorder(ownerId, itemId, expectedVersion, orderedIds); }
  /** @param {string} ownerId @param {string} id */
  remove(ownerId, id) { return this.repository.remove(ownerId, id); }
}
