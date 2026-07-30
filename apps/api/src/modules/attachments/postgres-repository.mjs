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
