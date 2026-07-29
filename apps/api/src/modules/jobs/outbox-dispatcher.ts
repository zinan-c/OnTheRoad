export type JobEvent = Readonly<{
  eventId: string;
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  aggregateVersion: number;
  schemaVersion: number;
}>;

export interface DispatchOutbox {
  listRecoverableOutbox(): JobEvent[];
  markPublished(eventId: string): void;
}

export interface EventPublisher {
  publish(event: JobEvent): Promise<void>;
}

type BullMqQueue = {
  add(
    name: string,
    data: JobEvent,
    options: { jobId: string; removeOnComplete: false },
  ): Promise<unknown>;
};

/**
 * BullMQ-compatible adapter without coupling the jobs domain to the library.
 * eventId is always the BullMQ jobId, so a live Redis instance deduplicates
 * dispatcher retries. PostgreSQL reconciliation recreates it after Redis loss.
 */
export class BullMqEventPublisher implements EventPublisher {
  constructor(private readonly queue: BullMqQueue) {}

  async publish(event: JobEvent): Promise<void> {
    await this.queue.add(event.eventType, event, {
      jobId: event.eventId,
      removeOnComplete: false,
    });
  }
}

export class OutboxDispatcher {
  constructor(
    private readonly outbox: DispatchOutbox,
    private readonly publisher: EventPublisher,
  ) {}

  async dispatchBatch(limit = 100): Promise<number> {
    const events = this.outbox.listRecoverableOutbox().slice(0, limit);
    for (const event of events) {
      await this.publisher.publish(event);
      this.outbox.markPublished(event.eventId);
    }
    return events.length;
  }
}
