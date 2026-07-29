export type JobEvent = Readonly<{
  eventId: string;
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  aggregateVersion: number;
  schemaVersion: number;
}>;

export interface InboxStore {
  applyInboxEffect(
    consumer: string,
    eventId: string,
    effect: () => Promise<void>,
  ): Promise<boolean>;
}

export class InboxConsumer {
  constructor(
    private readonly store: InboxStore,
    private readonly consumerName: string,
  ) {}

  async consume(
    event: JobEvent,
    effect: (event: JobEvent) => Promise<void>,
  ): Promise<{ applied: true } | { applied: false; reason: "duplicate" }> {
    const applied = await this.store.applyInboxEffect(
      this.consumerName,
      event.eventId,
      async () => effect(event),
    );
    return applied ? { applied: true } : { applied: false, reason: "duplicate" };
  }
}
