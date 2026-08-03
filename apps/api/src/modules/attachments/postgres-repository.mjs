import {
  PostgresExecutor,
  postgresErrorIdentity,
} from "@on-the-road/database/postgres";

import { AttachmentUploadError } from "./upload-session.mjs";
import { AttachmentGalleryError } from "./gallery.mjs";

/** @param {unknown} error */
function mapDatabaseError(error) {
  const { message } = postgresErrorIdentity(error);
  /** @type {Array<[string, number]>} */
  const mappings = [
    ["ATTACHMENT_NOT_FOUND", 404],
    ["ATTACHMENT_VERSION_CONFLICT", 409],
    ["UPLOAD_ALREADY_COMPLETED", 409],
    ["UPLOAD_SESSION_EXPIRED", 410],
    ["UPLOADED_OBJECT_MISMATCH", 409],
  ];
  for (const [code, status] of mappings) {
    if (message === code) {
      return new AttachmentUploadError(code, code.replaceAll("_", " ").toLowerCase(), status);
    }
  }
  return error;
}

export class PostgresAttachmentRepository {
  /**
   * @param {{
   *  databaseUrl?: string,
   *  pool?: import("@on-the-road/database/postgres").PostgresExecutor["pool"],
   *  executor?: import("@on-the-road/database/postgres").PostgresExecutor,
   *  storage?: {createReadUrl?: (key: string, version: string) => string}
   * }} options
   */
  constructor({ databaseUrl, pool, executor, storage }) {
    this.database = executor ?? new PostgresExecutor({
      databaseUrl,
      pool,
      role: "api",
    });
    this.storage = storage;
  }

  /** @param {Record<string, unknown>} attachment */
  insertPending(attachment) {
    if (attachment.tripId && attachment.itemId) {
      return this.#json(
        `WITH owned_item AS (
           SELECT id, trip_id
           FROM itinerary_item
           WHERE id = $9::uuid
             AND trip_id = $8::uuid
             AND owner_id = $2
             AND deleted_at IS NULL
         ), inserted AS (
           INSERT INTO attachment (
             id, owner_id, object_key, expected_content_type,
             expected_content_length, expected_checksum_sha256, expires_at,
             trip_id, itinerary_item_id,
             sort_order
           )
           SELECT
             $1::uuid, $2, $3, $4, $5, $6, $7::timestamptz,
             owned_item.trip_id, owned_item.id,
             COALESCE((
               SELECT max(sort_order) + 1
               FROM attachment
               WHERE itinerary_item_id = owned_item.id
                 AND deleted_at IS NULL
             ), 0)
           FROM owned_item
           RETURNING id
         )
         SELECT COALESCE(
           (
             SELECT jsonb_build_object(
               'id', id,
               'ownerId', $2,
               'tripId', $8::uuid,
               'itemId', $9::uuid,
               'status', 'pending',
               'version', 1
             )
             FROM inserted
           ),
           'null'::jsonb
         )`,
        [
          attachment.id,
          attachment.ownerId,
          attachment.objectKey,
          attachment.expectedContentType,
          attachment.expectedContentLength,
          attachment.expectedChecksumSha256,
          attachment.expiresAt,
          attachment.tripId,
          attachment.itemId,
        ],
      ).then((created) => {
        if (!created) {
          throw new AttachmentUploadError(
            "ATTACHMENT_ITEM_NOT_FOUND",
            "The gallery item was not found.",
            404,
          );
        }
        return created;
      });
    }
    return this.#json("SELECT create_attachment($1::jsonb)", [
      JSON.stringify(attachment),
    ]);
  }

  /** @param {string} id */
  findById(id) {
    return this.#json(
      `SELECT COALESCE(
        attachment_as_json($1::uuid),
        'null'::jsonb
      )`,
      [id],
    );
  }

  /** @param {string} ownerId @param {string} itemId */
  list(ownerId, itemId) {
    return this.#json(`SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'ownerId', a.owner_id, 'itemId', a.itinerary_item_id, 'status', a.status, 'thumbnailKey', a.thumbnail_key, 'thumbnailVersion', a.thumbnail_version, 'width', a.width, 'height', a.height, 'caption', a.caption, 'sortOrder', a.sort_order, 'isCover', a.is_cover, 'version', a.version, 'error', a.processing_error_code) ORDER BY a.sort_order, a.id), '[]'::jsonb) FROM attachment a WHERE a.owner_id = $1 AND a.itinerary_item_id = $2::uuid AND a.deleted_at IS NULL`, [ownerId, itemId]).then((attachments) => attachments.map((/** @type {any} */ attachment) => ({
      ...attachment,
      ...(attachment.status === "ready"
        && attachment.thumbnailKey
        && attachment.thumbnailVersion
        && this.storage?.createReadUrl
        ? {
            previewUrl: this.storage.createReadUrl(
              attachment.thumbnailKey,
              attachment.thumbnailVersion,
            ),
          }
        : {}),
    })));
  }

  /** @param {string} ownerId @param {string} id @param {number} expectedVersion @param {Record<string, any>} patch */
  async update(ownerId, id, expectedVersion, patch) {
    return this.database.transaction(async (client) => {
      const current = (await client.query(
        `SELECT id, itinerary_item_id, version
         FROM attachment
         WHERE id = $2::uuid
           AND owner_id = $1
           AND deleted_at IS NULL
         FOR UPDATE`,
        [ownerId, id],
      )).rows[0];
      if (!current) throw new AttachmentGalleryError("ATTACHMENT_NOT_FOUND", "Attachment was not found.", 404);
      if (current.version !== expectedVersion) throw new AttachmentGalleryError("ATTACHMENT_VERSION_CONFLICT", "Attachment changed.", 409);
      if (patch.isCover === true && current.itinerary_item_id) {
        await client.query(
          `UPDATE attachment
           SET is_cover = false,
               version = version + 1,
               updated_at = now()
           WHERE itinerary_item_id = $1::uuid
             AND id <> $2::uuid
             AND is_cover
             AND deleted_at IS NULL`,
          [current.itinerary_item_id, id],
        );
      }
      const updated = await client.query(
        `UPDATE attachment
         SET caption = COALESCE($4, caption),
             is_cover = COALESCE($5, is_cover),
             sort_order = COALESCE($6, sort_order),
             version = version + 1,
             updated_at = now()
         WHERE id = $2::uuid
           AND owner_id = $1
           AND version = $3
         RETURNING jsonb_build_object(
           'id', id, 'ownerId', owner_id, 'itemId', itinerary_item_id,
           'status', status, 'thumbnailKey', thumbnail_key,
           'thumbnailVersion', thumbnail_version, 'width', width,
           'height', height, 'caption', caption, 'sortOrder', sort_order,
           'isCover', is_cover, 'version', version,
           'error', processing_error_code
         ) AS value`,
        [
          ownerId,
          id,
          expectedVersion,
          patch.caption ?? null,
          patch.isCover ?? null,
          patch.sortOrder ?? null,
        ],
      );
      return updated.rows[0]?.value;
    });
  }

  /** @param {string} ownerId @param {string} itemId @param {number | Record<string, number>} expectedVersion @param {string[]} orderedIds */
  async reorder(ownerId, itemId, expectedVersion, orderedIds) {
    return this.database.transaction(async (client) => {
      const current = (await client.query(
        `SELECT id, version
         FROM attachment
         WHERE owner_id = $1
           AND itinerary_item_id = $2::uuid
           AND deleted_at IS NULL
         ORDER BY id
         FOR UPDATE`,
        [ownerId, itemId],
      )).rows;
      if (
        current.length !== orderedIds.length
        || new Set(orderedIds).size !== orderedIds.length
        || current.some(({ id }) => !orderedIds.includes(id))
      ) {
        throw new AttachmentGalleryError(
          "ATTACHMENT_ORDER_INCOMPLETE",
          "Order must include every visible attachment.",
          409,
        );
      }
      if (current.some(({ id, version }) =>
        version !== (typeof expectedVersion === "number"
          ? expectedVersion
          : expectedVersion[id]))) {
        throw new AttachmentGalleryError(
          "ATTACHMENT_VERSION_CONFLICT",
          "Gallery changed.",
          409,
        );
      }
      await client.query(
        `UPDATE attachment
         SET sort_order = position.sort_order,
             version = version + 1,
             updated_at = now()
         FROM unnest($3::uuid[]) WITH ORDINALITY AS desired(id, ordinal)
         CROSS JOIN LATERAL (
           SELECT (desired.ordinal - 1)::integer AS sort_order
         ) position
         WHERE attachment.id = desired.id
           AND attachment.owner_id = $1
           AND attachment.itinerary_item_id = $2::uuid`,
        [ownerId, itemId, orderedIds],
      );
      const reordered = await client.query(
        `SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'id', id, 'ownerId', owner_id, 'itemId', itinerary_item_id,
               'status', status, 'thumbnailKey', thumbnail_key,
               'thumbnailVersion', thumbnail_version, 'width', width,
               'height', height, 'caption', caption, 'sortOrder', sort_order,
               'isCover', is_cover, 'version', version,
               'error', processing_error_code
             )
             ORDER BY sort_order, id
           ),
           '[]'::jsonb
         ) AS value
         FROM attachment
         WHERE owner_id = $1
           AND itinerary_item_id = $2::uuid
           AND deleted_at IS NULL`,
        [ownerId, itemId],
      );
      return reordered.rows[0]?.value ?? [];
    });
  }

  /** @param {string} ownerId @param {string} id */
  remove(ownerId, id) { return this.#json(`UPDATE attachment SET deleted_at = now(), version = version + 1, updated_at = now() WHERE id = $2::uuid AND owner_id = $1 AND deleted_at IS NULL RETURNING jsonb_build_object('id', id, 'deletedAt', deleted_at, 'version', version)`, [ownerId, id]); }

  /** @param {string} ownerId @param {string} id */
  retry(ownerId, id) {
    return this.#json(
      `UPDATE attachment
       SET status = 'uploaded',
           processing_error_code = NULL,
           version = version + 1,
           updated_at = now()
       WHERE id = $2::uuid
         AND owner_id = $1
         AND status = 'failed'
         AND deleted_at IS NULL
       RETURNING attachment_as_json(id)`,
      [ownerId, id],
    ).then((retried) => {
      if (!retried) {
        throw new AttachmentUploadError(
          "MEDIA_NOT_RETRYABLE",
          "Attachment is not retryable.",
          409,
        );
      }
      return retried;
    });
  }

  /** @param {string} id @param {number} expectedVersion @param {{ownerId: string} & Record<string, unknown>} metadata */
  complete(id, expectedVersion, metadata) {
    return this.#json(
      `SELECT complete_attachment(
        $1,
        $2::uuid,
        $3::integer,
        $4::jsonb
      )`,
      [metadata.ownerId, id, expectedVersion, JSON.stringify(metadata)],
    );
  }

  close() {
    return this.database.close();
  }

  /** @param {string} sql @param {readonly unknown[]} [values] */
  async #json(sql, values = []) {
    try {
      return await this.database.json(sql, values);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
