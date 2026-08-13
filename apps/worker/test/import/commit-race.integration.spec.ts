import { describe, expect, test } from "vitest";

import { PostgresImportCommitProcessor } from "../../src/processors/import/postgres-commit-processor.js";
import { FakeCommitDatabase, type FakeImportJob, type FakeImportRow } from "./fake-commit-database.js";

const tripId = "00000000-0000-4000-8000-000000000301";

function job(id: string, source: string, status = "importing"): FakeImportJob {
  return {
    id,
    trip_id: tripId,
    owner_id: "e08-owner",
    source_sha256: source,
    importer_version: "runtime-1",
    mapping_hash: "mapping-1",
    status,
    committed_rows: 0,
    imported_rows: 0,
    error_rows: 0,
    default_currency: "CNY",
  };
}

function row(id: string, sourceKey: string, fingerprint: string, normalized: Record<string, unknown>, status: FakeImportRow["status"] = "new"): FakeImportRow {
  return {
    id,
    source_row_key: sourceKey,
    fingerprint,
    normalized_data: normalized,
    status,
    decision_scope: "default",
    staged_location: null,
  };
}

describe("TC-E08-02 import insert/update race and cancel/resume", () => {
  test("concurrent insert↔insert claims one item and never overwrites the winner", async () => {
    const first = job("job-insert-a", "a".repeat(64));
    const second = job("job-insert-b", "b".repeat(64));
    const database = new FakeCommitDatabase(
      [first, second],
      {
        [first.id]: [row("row-a", "Itinerary:2", "same-fingerprint", { day: 1, target: "同一地点", cost: 20, currency: "CNY" })],
        [second.id]: [row("row-b", "Itinerary:2", "same-fingerprint", { day: 1, target: "另一份文字", cost: 99, currency: "CNY" })],
      },
      { raceParticipants: 2 },
    );
    const processor = new PostgresImportCommitProcessor({ executor: database as never, chunkSize: 1 });

    await Promise.all([processor.process(first.id), processor.process(second.id)]);

    expect(database.items).toHaveLength(1);
    expect(database.expenses).toHaveLength(1);
    expect(database.ledger).toHaveLength(2);
    expect([...database.ledger.values()].map(({ action }) => action).sort()).toEqual(["insert", "skip"]);
    expect([...database.jobs.values()].map(({ committed_rows }) => committed_rows)).toEqual([1, 1]);
  });

  test("serializes update↔insert on the owner-aware claim and preserves the update target", async () => {
    const updateJob = job("job-update", "c".repeat(64));
    const insertJob = job("job-insert", "d".repeat(64));
    const database = new FakeCommitDatabase(
      [updateJob, insertJob],
      {
        [updateJob.id]: [row("row-update", "Itinerary:3", "update-fingerprint", {
          day: 1,
          target: "更新后的标题",
          externalSource: "partner",
          externalId: "item-1",
        }, "update")],
        [insertJob.id]: [row("row-insert", "Itinerary:3", "update-fingerprint", {
          day: 1,
          target: "不应覆盖",
          externalSource: "partner",
          externalId: "item-1",
        })],
      },
      { raceParticipants: 2 },
    );
    database.items.set("item-1", {
      id: "item-1",
      target: "原始标题",
      externalSource: "partner",
      externalId: "item-1",
      version: 1,
    });
    const processor = new PostgresImportCommitProcessor({ executor: database as never, chunkSize: 1 });

    await Promise.all([processor.process(updateJob.id), processor.process(insertJob.id)]);

    expect(database.items).toHaveLength(1);
    expect(database.items.get("item-1")).toMatchObject({ target: "更新后的标题", version: 2 });
    expect([...database.ledger.values()].map(({ action }) => action).sort()).toEqual(["insert", "update"]);
  });

  test("stops after a chunk cancellation and resumes remaining rows without duplicating committed text", async () => {
    const source = job("job-cancel", "e".repeat(64));
    const database = new FakeCommitDatabase(
      [source],
      {
        [source.id]: [
          row("row-1", "Itinerary:2", "fingerprint-1", { day: 1, target: "已提交", cost: 10, currency: "CNY" }, "imported"),
          row("row-2", "Itinerary:3", "fingerprint-2", { day: 1, target: "待续跑", cost: 20, currency: "CNY" }),
        ],
      },
    );
    database.items.set("item-existing", {
      id: "item-existing",
      target: "已提交",
      externalSource: null,
      externalId: null,
      version: 1,
    });
    database.jobs.get(source.id)!.status = "cancelling";
    const processor = new PostgresImportCommitProcessor({ executor: database as never, chunkSize: 1 });

    await expect(processor.processChunk(source.id)).resolves.toMatchObject({ status: "cancelled", committedRows: 0 });
    expect(database.jobs.get(source.id)?.status).toBe("cancelled");

    const resumedId = "job-resumed";
    const resumed = job(resumedId, source.source_sha256, "importing");
    database.jobs.set(resumedId, resumed);
    database.seedRows(resumedId, [
      row("row-1-resumed", "Itinerary:2", "fingerprint-1", { day: 1, target: "已提交", cost: 10, currency: "CNY" }, "ready"),
      row("row-2-resumed", "Itinerary:3", "fingerprint-2", { day: 1, target: "待续跑", cost: 20, currency: "CNY" }, "ready"),
    ]);
    database.ledger.set([
      tripId,
      source.source_sha256,
      source.importer_version,
      source.mapping_hash,
      "Itinerary:2",
      "default",
    ].join("\u0000"), { action: "insert", itineraryItemId: "item-existing" });
    const result = await processor.process(resumedId);

    expect(result.status).toBe("completed");
    expect(database.items).toHaveLength(2);
    expect(database.items.get("item-existing")?.target).toBe("已提交");
    expect([...database.items.values()].filter(({ target }) => target === "已提交")).toHaveLength(1);
  });
});
