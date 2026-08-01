export const JOB_EVENT_SCHEMA_VERSION = 1;

export type JobEvent = Readonly<{
  eventId: string;
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  aggregateVersion: number;
  schemaVersion: number;
}>;

type OutboxRecord = JobEvent & {
  createdAt: Date;
  publishedAt?: Date;
  handledAt?: Date;
};

const EVENT_FIELDS = new Set([
  "eventId",
  "eventType",
  "aggregateId",
  "aggregateType",
  "aggregateVersion",
  "schemaVersion",
]);

export function assertJobEvent(
  candidate: Record<string, unknown>,
): asserts candidate is JobEvent {
  const unexpected = Object.keys(candidate).filter((field) => !EVENT_FIELDS.has(field));
  if (unexpected.length > 0) {
    throw new TypeError(`Event payload contains unsupported fields: ${unexpected.join(", ")}`);
  }
  for (const field of ["eventId", "eventType", "aggregateId", "aggregateType"] as const) {
    if (typeof candidate[field] !== "string" || candidate[field].length === 0) {
      throw new TypeError(`${field} must be a non-empty string`);
    }
  }
  for (const field of ["aggregateVersion", "schemaVersion"] as const) {
    if (!Number.isSafeInteger(candidate[field]) || Number(candidate[field]) < 1) {
      throw new TypeError(`${field} must be a positive integer`);
    }
  }
}

/**
 * Deterministic adapter used by contract/fault tests. Production persistence is
 * defined by jobs.sql and implements the same methods through PostgreSQL.
 */
export class InMemoryJobStore {
  readonly #outbox = new Map<string, OutboxRecord>();
  readonly #inbox = new Set<string>();
  readonly #inboxClaims = new Set<string>();

  appendOutboxEvent(candidate: Record<string, unknown>): JobEvent {
    assertJobEvent(candidate);
    if (this.#outbox.has(candidate.eventId)) {
      throw new Error(`Duplicate outbox event: ${candidate.eventId}`);
    }
    const aggregateCollision = [...this.#outbox.values()].some(
      (record) =>
        record.aggregateType === candidate.aggregateType &&
        record.aggregateId === candidate.aggregateId &&
        record.aggregateVersion === candidate.aggregateVersion,
    );
    if (aggregateCollision) {
      throw new Error("Aggregate version already has an outbox event");
    }
    const record = { ...candidate, createdAt: new Date() };
    this.#outbox.set(candidate.eventId, record);
    return this.#toEvent(record);
  }

  listRecoverableOutbox(): JobEvent[] {
    return [...this.#outbox.values()]
      .filter((record) => record.handledAt === undefined)
      .sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.aggregateVersion - right.aggregateVersion ||
          left.eventId.localeCompare(right.eventId),
      )
      .map((record) => this.#toEvent(record));
  }

  markPublished(eventId: string): void {
    const record = this.#requiredOutbox(eventId);
    record.publishedAt = new Date();
  }

  markHandled(eventId: string): void {
    const record = this.#requiredOutbox(eventId);
    record.handledAt = new Date();
  }

  hasInboxReceipt(consumer: string, eventId: string): boolean {
    return this.#inbox.has(this.#inboxKey(consumer, eventId));
  }

  async applyInboxEffect(
    consumer: string,
    eventId: string,
    effect: () => Promise<void>,
  ): Promise<boolean> {
    const key = this.#inboxKey(consumer, eventId);
    if (this.#inbox.has(key) || this.#inboxClaims.has(key)) return false;
    this.#inboxClaims.add(key);
    try {
      await effect();
      this.#inbox.add(key);
      const localOutboxRecord = this.#outbox.get(eventId);
      if (localOutboxRecord) localOutboxRecord.handledAt = new Date();
      return true;
    } finally {
      this.#inboxClaims.delete(key);
    }
  }

  #requiredOutbox(eventId: string): OutboxRecord {
    const record = this.#outbox.get(eventId);
    if (!record) throw new Error(`Unknown outbox event: ${eventId}`);
    return record;
  }

  #inboxKey(consumer: string, eventId: string): string {
    return `${consumer}\u0000${eventId}`;
  }

  #toEvent(record: OutboxRecord): JobEvent {
    return {
      eventId: record.eventId,
      eventType: record.eventType,
      aggregateId: record.aggregateId,
      aggregateType: record.aggregateType,
      aggregateVersion: record.aggregateVersion,
      schemaVersion: record.schemaVersion,
    };
  }
}
