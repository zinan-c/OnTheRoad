import { describe, expect, test } from "vitest";

import { InMemoryJobStore } from "@on-the-road/database/jobs";
import { InboxConsumer } from "../src/processors/maintenance/inbox-consumer.js";

describe("TC-A06-01 outbox/inbox once-only effect", () => {
  test("a duplicate event delivery records one inbox entry and applies one effect", async () => {
    const store = new InMemoryJobStore();
    const event = store.appendOutboxEvent({
      aggregateId: "trip-01",
      aggregateType: "trip",
      eventId: "event-01",
      eventType: "trip.created",
      aggregateVersion: 1,
      schemaVersion: 1,
    });
    let effects = 0;
    const consumer = new InboxConsumer(store, "route-worker");

    const first = await consumer.consume(event, async () => {
      effects += 1;
    });
    const duplicate = await consumer.consume(event, async () => {
      effects += 1;
    });

    expect(first).toEqual({ applied: true });
    expect(duplicate).toEqual({ applied: false, reason: "duplicate" });
    expect(effects).toBe(1);
    expect(store.hasInboxReceipt("route-worker", event.eventId)).toBe(true);
  });
});
