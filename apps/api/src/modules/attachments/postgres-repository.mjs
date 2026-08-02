import {
  PostgresExecutor,
  postgresErrorIdentity,
} from "@on-the-road/database/postgres";

import { AttachmentUploadError } from "./upload-session.mjs";

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
   *  executor?: import("@on-the-road/database/postgres").PostgresExecutor
   * }} options
   */
  constructor({ databaseUrl, pool, executor }) {
    this.database = executor ?? new PostgresExecutor({
      databaseUrl,
      pool,
      role: "api",
    });
  }

  /** @param {Record<string, unknown>} attachment */
  insertPending(attachment) {
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
  list(ownerId, itemId) { return this.#json(`SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'ownerId', a.owner_id, 'itemId', a.itinerary_item_id, 'status', a.status, 'previewUrl', NULL, 'width', a.width, 'height', a.height, 'caption', a.caption, 'sortOrder', a.sort_order, 'isCover', a.is_cover, 'version', a.version, 'error', a.processing_error_code) ORDER BY a.sort_order, a.id), '[]'::jsonb) FROM attachment a WHERE a.owner_id = $1 AND a.itinerary_item_id = $2::uuid AND a.deleted_at IS NULL`, [ownerId, itemId]); }

  /** @param {string} ownerId @param {string} id @param {number} expectedVersion @param {Record<string, any>} patch */
  update(ownerId, id, expectedVersion, patch) { return this.#json(`UPDATE attachment SET caption = COALESCE($4, caption), is_cover = COALESCE($5, is_cover), sort_order = COALESCE($6, sort_order), version = version + 1, updated_at = now() WHERE id = $2::uuid AND owner_id = $1 AND version = $3 RETURNING jsonb_build_object('id', id, 'ownerId', owner_id, 'itemId', itinerary_item_id, 'status', status, 'previewUrl', NULL, 'width', width, 'height', height, 'caption', caption, 'sortOrder', sort_order, 'isCover', is_cover, 'version', version, 'error', processing_error_code)`, [ownerId, id, expectedVersion, patch.caption ?? null, patch.isCover ?? null, patch.sortOrder ?? null]); }

  /** @param {string} ownerId @param {string} id */
  remove(ownerId, id) { return this.#json(`UPDATE attachment SET deleted_at = now(), version = version + 1, updated_at = now() WHERE id = $2::uuid AND owner_id = $1 AND deleted_at IS NULL RETURNING jsonb_build_object('id', id, 'deletedAt', deleted_at, 'version', version)`, [ownerId, id]); }

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
