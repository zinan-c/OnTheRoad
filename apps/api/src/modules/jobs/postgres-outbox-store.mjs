// @ts-nocheck
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function text(value) {
  return `convert_from(decode('${encode([value])}', 'base64'), 'utf8')::jsonb->>0`;
}

export class PostgresOutboxStore {
  constructor({ databaseUrl, psqlBin = process.env.PSQL_BIN || "psql" }) {
    if (!databaseUrl) throw new TypeError("databaseUrl is required");
    this.databaseUrl = databaseUrl;
    this.psqlBin = psqlBin;
  }

  async appendOutboxEvent(event) {
    await this.#run(`
      INSERT INTO job_outbox (
        event_id, event_type, aggregate_type, aggregate_id,
        aggregate_version, schema_version
      ) VALUES (
        ${text(event.eventId)}, ${text(event.eventType)},
        ${text(event.aggregateType)}, ${text(event.aggregateId)},
        ${Number(event.aggregateVersion)}, ${Number(event.schemaVersion)}
      )
    `);
  }

  async listRecoverableOutbox() {
    const output = await this.#run(`
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'eventId', event_id,
            'eventType', event_type,
            'aggregateId', aggregate_id,
            'aggregateType', aggregate_type,
            'aggregateVersion', aggregate_version,
            'schemaVersion', schema_version
          )
          ORDER BY created_at, event_id
        ),
        '[]'::jsonb
      )::text
      FROM job_outbox
      WHERE handled_at IS NULL
        AND next_attempt_at <= now()
    `);
    return JSON.parse(output || "[]");
  }

  async markPublished(eventId) {
    await this.#run(`
      UPDATE job_outbox
      SET published_at = COALESCE(published_at, now()),
          publish_attempts = publish_attempts + 1
      WHERE event_id = ${text(eventId)}
    `);
  }

  async remove(eventId) {
    await this.#run(`DELETE FROM job_outbox WHERE event_id = ${text(eventId)}`);
  }

  async #run(sql) {
    const { stdout } = await execFileAsync(
      this.psqlBin,
      [this.databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
      { maxBuffer: 2 * 1024 * 1024 },
    );
    return stdout.trim();
  }
}
