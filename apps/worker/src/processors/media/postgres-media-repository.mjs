import { MediaPipelineError } from "./media-pipeline.js";
import {
  PostgresExecutor,
  postgresErrorIdentity,
} from "@on-the-road/database/postgres";

/** @param {unknown} error */
function mapDatabaseError(error) {
  const { message } = postgresErrorIdentity(error);
  for (const code of ["MEDIA_NOT_CLAIMABLE", "MEDIA_VERSION_CONFLICT"]) {
    if (message === code) {
      return new MediaPipelineError(
        code,
        code === "MEDIA_VERSION_CONFLICT"
          ? "The attachment changed while it was processing."
          : "The attachment is not awaiting processing.",
        code === "MEDIA_VERSION_CONFLICT",
      );
    }
  }
  return error;
}

export class PostgresMediaRepository {
  /**
   * @param {{
   *  databaseUrl?: string,
   *  pool?: import("@on-the-road/database/postgres").PostgresExecutor["pool"],
   *  executor?: import("@on-the-road/database/postgres").PostgresExecutor
   * }} [options]
   */
  constructor({ databaseUrl, pool, executor } = {}) {
    this.database = executor ?? new PostgresExecutor({
      databaseUrl,
      pool,
      role: "worker",
    });
  }

  /** @param {string} id */
  claim(id) {
    return this.#json(
      "SELECT claim_attachment_processing($1::uuid)::text",
      [id],
    );
  }

  /** @param {string} id @param {number} expectedVersion @param {Record<string, unknown>} metadata */
  markReady(id, expectedVersion, metadata) {
    return this.#json(
      `SELECT mark_attachment_ready(
        $1::uuid,
        $2::integer,
        $3::jsonb
      )::text`,
      [id, expectedVersion, JSON.stringify(metadata)],
    );
  }

  /** @param {string} id @param {number} expectedVersion @param {string} errorCode */
  markFailed(id, expectedVersion, errorCode) {
    return this.#json(
      `SELECT mark_attachment_failed(
        $1::uuid,
        $2::integer,
        $3
      )::text`,
      [id, expectedVersion, errorCode],
    );
  }

  async listRecoverableAttachmentIds(limit = 100) {
    const result = await this.database.query(
      `SELECT id
       FROM attachment
       WHERE purpose = 'media'
         AND status = 'uploaded'
         AND deleted_at IS NULL
       ORDER BY updated_at, id
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(({ id }) => id);
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
