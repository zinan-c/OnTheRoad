// @ts-nocheck
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { AttachmentUploadError } from "./upload-session.mjs";

const execFileAsync = promisify(execFile);

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function jsonExpression(value) {
  return `convert_from(decode('${encode(value)}', 'base64'), 'utf8')::jsonb`;
}

function mapDatabaseError(error) {
  const message = `${error?.stderr ?? ""}\n${error?.message ?? ""}`;
  const mappings = [
    ["ATTACHMENT_NOT_FOUND", 404],
    ["ATTACHMENT_VERSION_CONFLICT", 409],
    ["UPLOAD_ALREADY_COMPLETED", 409],
    ["UPLOAD_SESSION_EXPIRED", 410],
    ["UPLOADED_OBJECT_MISMATCH", 409],
  ];
  for (const [code, status] of mappings) {
    if (message.includes(code)) {
      return new AttachmentUploadError(code, code.replaceAll("_", " ").toLowerCase(), status);
    }
  }
  return error;
}

export class PostgresAttachmentRepository {
  constructor({ databaseUrl, psqlBin = process.env.PSQL_BIN || "psql" }) {
    if (!databaseUrl) throw new TypeError("databaseUrl is required");
    this.databaseUrl = databaseUrl;
    this.psqlBin = psqlBin;
  }

  insertPending(attachment) {
    return this.#json(`SELECT create_attachment(${jsonExpression(attachment)})::text`);
  }

  findById(id) {
    return this.#json(
      `SELECT COALESCE(
        attachment_as_json((${jsonExpression([id])}->>0)::uuid),
        'null'::jsonb
      )::text`,
    );
  }

  complete(id, expectedVersion, metadata) {
    return this.#json(
      `SELECT complete_attachment(
        ${jsonExpression([metadata.ownerId])}->>0,
        (${jsonExpression([id])}->>0)::uuid,
        (${jsonExpression([expectedVersion])}->>0)::integer,
        ${jsonExpression(metadata)}
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
      return JSON.parse(stdout.trim() || "null");
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
