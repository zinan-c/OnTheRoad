// @ts-nocheck
import { MediaPipelineError } from "./media-pipeline.js";
import {
  PostgresExecutor,
  postgresErrorIdentity,
} from "@on-the-road/database/postgres";

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
  constructor({ databaseUrl, pool, executor } = {}) {
    this.database = executor ?? new PostgresExecutor({
      databaseUrl,
      pool,
      role: "worker",
    });
  }

  claim(id) {
    return this.#json(
      "SELECT claim_attachment_processing($1::uuid)::text",
      [id],
    );
  }

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

  close() {
    return this.database.close();
  }

  async #json(sql, values = []) {
    try {
      return await this.database.json(sql, values);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
