import { describe, expect, test } from "vitest";

import {
  normalizeImportRow,
  stableFingerprint,
  stableSourceRowKey,
  validateNormalizedRow,
} from "@on-the-road/importer";

type StagedRow = {
  sourceRowKey: string;
  normalizedData: Record<string, unknown>;
  fingerprint: string;
  status: "ready" | "error" | "duplicate";
  errors: ReturnType<typeof validateNormalizedRow>;
};

/**
 * Test-local queue consumer for the E04 row contract. It intentionally does
 * not stand in for the missing production Postgres staging processor; it
 * makes the expected worker inputs/outputs executable before that processor
 * is wired to import_job/import_row.
 */
class StagingWorkerHarness {
  #rows = new Map<string, StagedRow>();

  consume(sheetName: string, rowNumber: number, rawData: Record<string, unknown>): StagedRow {
    const sourceRowKey = stableSourceRowKey(sheetName, rowNumber);
    const existing = this.#rows.get(sourceRowKey);
    if (existing) return { ...existing, status: "duplicate" };
    const normalizedData = normalizeImportRow(rawData);
    const errors = validateNormalizedRow(normalizedData);
    const row: StagedRow = {
      sourceRowKey,
      normalizedData,
      fingerprint: stableFingerprint(normalizedData),
      status: errors.length ? "error" : "ready",
      errors,
    };
    this.#rows.set(sourceRowKey, row);
    return row;
  }
}

describe("E04 staging integration/worker contract", () => {
  test("normalizes, validates, fingerprints, and idempotently stages rows", () => {
    const worker = new StagingWorkerHarness();
    const valid = worker.consume("旅程", 2, {
      Day: "1",
      Target: "外滩",
      Cost: "12.50",
      Currency: "CNY",
      ImageURLs: "https://example.test/arrival.png",
    });
    const invalid = worker.consume("旅程", 3, { Day: "0" });
    const retry = worker.consume("旅程", 2, {
      Day: "1",
      Target: "外滩",
      Cost: "12.50",
      Currency: "CNY",
      ImageURLs: "https://example.test/arrival.png",
    });

    expect(valid).toMatchObject({
      sourceRowKey: "旅程:2",
      status: "ready",
      normalizedData: { day: 1, target: "外滩", cost: 12.5 },
    });
    expect(valid.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(invalid).toMatchObject({
      sourceRowKey: "旅程:3",
      status: "error",
    });
    expect(invalid.errors.map(({ code }) => code)).toContain("TARGET_REQUIRED");
    expect(retry).toMatchObject({
      sourceRowKey: "旅程:2",
      status: "duplicate",
      fingerprint: valid.fingerprint,
    });
  });
});
