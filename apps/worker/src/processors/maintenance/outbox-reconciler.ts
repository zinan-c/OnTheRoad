export type JobEvent = Readonly<{
  eventId: string;
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  aggregateVersion: number;
  schemaVersion: number;
}>;

export interface RecoverableOutbox {
  listRecoverableOutbox(): JobEvent[];
  markPublished(eventId: string): void;
}

export interface JobQueue {
  has(eventId: string): Promise<boolean>;
  add(event: JobEvent): Promise<void>;
}

export class OutboxReconciler {
  constructor(
    private readonly outbox: RecoverableOutbox,
    private readonly queue: JobQueue,
  ) {}

  async reconcile(): Promise<{ scanned: number; enqueued: number }> {
    const events = this.outbox.listRecoverableOutbox();
    let enqueued = 0;
    for (const event of events) {
      if (await this.queue.has(event.eventId)) continue;
      await this.queue.add(event);
      this.outbox.markPublished(event.eventId);
      enqueued += 1;
    }
    return { scanned: events.length, enqueued };
  }
}

export class InMemoryJobQueue implements JobQueue {
  readonly #events = new Map<string, JobEvent>();

  async has(eventId: string): Promise<boolean> {
    return this.#events.has(eventId);
  }

  async add(event: JobEvent): Promise<void> {
    this.#events.set(event.eventId, event);
  }

  eventIds(): string[] {
    return [...this.#events.keys()];
  }

  clear(): void {
    this.#events.clear();
  }
}
