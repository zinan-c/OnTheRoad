// @ts-nocheck
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { MediaPipelineError } from "./media-pipeline.js";

const execFileAsync = promisify(execFile);

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function jsonExpression(value) {
  return `convert_from(decode('${encode(value)}', 'base64'), 'utf8')::jsonb`;
}

function mapDatabaseError(error) {
  const message = `${error?.stderr ?? ""}\n${error?.message ?? ""}`;
  for (const code of ["MEDIA_NOT_CLAIMABLE", "MEDIA_VERSION_CONFLICT"]) {
    if (message.includes(code)) {
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
  constructor({ databaseUrl, psqlBin = process.env.PSQL_BIN || "psql" }) {
    if (!databaseUrl) throw new TypeError("databaseUrl is required");
    this.databaseUrl = databaseUrl;
    this.psqlBin = psqlBin;
  }

  claim(id) {
    return this.#json(
      `SELECT claim_attachment_processing((${jsonExpression([id])}->>0)::uuid)::text`,
    );
  }

  markReady(id, expectedVersion, metadata) {
    return this.#json(
      `SELECT mark_attachment_ready(
        (${jsonExpression([id])}->>0)::uuid,
        (${jsonExpression([expectedVersion])}->>0)::integer,
        ${jsonExpression(metadata)}
      )::text`,
    );
  }

  markFailed(id, expectedVersion, errorCode) {
    return this.#json(
      `SELECT mark_attachment_failed(
        (${jsonExpression([id])}->>0)::uuid,
        (${jsonExpression([expectedVersion])}->>0)::integer,
        ${jsonExpression([errorCode])}->>0
      )::text`,
    );
  }

  async #json(sql) {
    try {
      const { stdout } = await execFileAsync(
        this.psqlBin,
        [this.databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
        { maxBuffer: 2 * 1024 * 1024 },
      );
      return JSON.parse(stdout.trim());
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
