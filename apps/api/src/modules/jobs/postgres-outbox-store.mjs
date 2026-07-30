import { PostgresExecutor } from "@on-the-road/database/postgres";

export class PostgresOutboxStore {
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
      role: "api",
    });
  }

  /** @param {{eventId: string, eventType: string, aggregateType: string, aggregateId: string, aggregateVersion: number, schemaVersion: number}} event */
  async appendOutboxEvent(event) {
    await this.database.query(`
      INSERT INTO job_outbox (
        event_id, event_type, aggregate_type, aggregate_id,
        aggregate_version, schema_version
      ) VALUES (
        $1, $2, $3, $4, $5, $6
      )
    `, [
      event.eventId,
      event.eventType,
      event.aggregateType,
      event.aggregateId,
      event.aggregateVersion,
      event.schemaVersion,
    ]);
  }

  async listRecoverableOutbox() {
    return this.database.json(`
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
  }

  /** @param {string} eventId */
  async markPublished(eventId) {
    await this.database.query(`
      UPDATE job_outbox
      SET published_at = COALESCE(published_at, now()),
          publish_attempts = publish_attempts + 1
      WHERE event_id = $1
    `, [eventId]);
  }

  /** @param {string} eventId */
  async remove(eventId) {
    await this.database.query("DELETE FROM job_outbox WHERE event_id = $1", [
      eventId,
    ]);
  }

  close() {
    return this.database.close();
  }
}
