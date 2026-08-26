import { describe, expect, test } from "vitest";

import { InMemoryJobStore } from "@on-the-road/database/jobs";
import {
  assertJobTransition,
  canTransitionJob,
} from "@on-the-road/database/job-status";
import {
  InMemoryJobQueue,
  OutboxReconciler,
} from "../src/processors/maintenance/outbox-reconciler.js";
import type { JobEvent, JobQueue } from "../src/processors/maintenance/outbox-reconciler.js";

describe("TC-A06-02 crash/Redis loss reconciliation", () => {
  test("DB scanning restores every event after commit-before-publish and queue loss", async () => {
    const store = new InMemoryJobStore();
    store.appendOutboxEvent({
      aggregateId: "trip-01",
      aggregateType: "trip",
      eventId: "event-01",
      eventType: "trip.updated",
      aggregateVersion: 1,
      schemaVersion: 1,
    });
    store.appendOutboxEvent({
      aggregateId: "trip-01",
      aggregateType: "trip",
      eventId: "event-02",
      eventType: "trip.updated",
      aggregateVersion: 2,
      schemaVersion: 1,
    });

    // The process dies after the DB commit and before publishing anything.
    const queue = new InMemoryJobQueue();
    const reconciler = new OutboxReconciler(store, queue);
    expect(await reconciler.reconcile()).toEqual({
      scanned: 2,
      enqueued: 2,
    });
    expect(queue.eventIds()).toEqual(["event-01", "event-02"]);

    // Redis is then lost. Published markers in PostgreSQL must not hide work.
    queue.clear();
    expect(await reconciler.reconcile()).toEqual({
      scanned: 2,
      enqueued: 2,
    });
    expect(queue.eventIds()).toEqual(["event-01", "event-02"]);
  });

  test("a failed delivery is eligible for reconciliation after the queue removes it", async () => {
    const store = new InMemoryJobStore();
    store.appendOutboxEvent({
      aggregateId: "trip-01",
      aggregateType: "trip",
      eventId: "event-failed",
      eventType: "route.rebuild.requested",
      aggregateVersion: 1,
      schemaVersion: 1,
    });

    let failed = true;
    const enqueued: string[] = [];
    const queue: JobQueue = {
      async has() { return !failed; },
      async add(event: JobEvent) {
        failed = false;
        enqueued.push(event.eventId);
      },
    };
    const reconciler = new OutboxReconciler(store, queue);

    expect(await reconciler.reconcile()).toEqual({ scanned: 1, enqueued: 1 });
    expect(enqueued).toEqual(["event-failed"]);
    expect(await reconciler.reconcile()).toEqual({ scanned: 1, enqueued: 0 });
  });

  test("event payloads contain identifiers and versions only", () => {
    const store = new InMemoryJobStore();

    expect(() =>
      store.appendOutboxEvent({
        aggregateId: "trip-01",
        aggregateType: "trip",
        eventId: "event-private",
        eventType: "trip.updated",
        aggregateVersion: 1,
        schemaVersion: 1,
        payload: { address: "must not enter an event" },
      }),
    ).toThrow(/payload/i);
  });

  test("job status is authoritative and terminal states cannot be retried", () => {
    expect(canTransitionJob("pending", "running")).toBe(true);
    expect(canTransitionJob("running", "retry_wait")).toBe(true);
    expect(canTransitionJob("retry_wait", "running")).toBe(true);
    expect(canTransitionJob("succeeded", "running")).toBe(false);
    expect(() => assertJobTransition("failed", "running")).toThrow(/invalid job status/i);
  });
});
