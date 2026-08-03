import { PostgresExecutor } from "@on-the-road/database/postgres";
import type { JobEvent } from "./outbox-reconciler.js";

export class PostgresRecoverableOutbox {
  readonly #database: PostgresExecutor;

  constructor(databaseUrl: string) {
    this.#database = new PostgresExecutor({ databaseUrl, role: "worker" });
  }

  listRecoverableOutbox(): Promise<JobEvent[]> {
    return this.#database.json(
      `SELECT COALESCE(
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
       )
       FROM job_outbox
       WHERE handled_at IS NULL
         AND next_attempt_at <= now()`,
    );
  }

  async markPublished(eventId: string): Promise<void> {
    await this.#database.query(
      `UPDATE job_outbox
       SET published_at = COALESCE(published_at, now()),
           publish_attempts = publish_attempts + 1
       WHERE event_id = $1
         AND handled_at IS NULL`,
      [eventId],
    );
  }

  close(): Promise<void> {
    return this.#database.close();
  }
}
