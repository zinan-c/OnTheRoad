import { describe, expect, test } from "vitest";

import {
  assertImportCommitCanStart,
  assertImportCommitCancelable,
  importOverrideScope,
  importRowReplayKey,
} from "../src/import/commit.js";

describe("M4 import commit boundaries", () => {
  test("keeps exact replay identity separate from a one-time override", () => {
    const input = {
      sourceSha256: "a".repeat(64),
      importerVersion: "runtime-1",
      mappingHash: "b".repeat(64),
      sourceRowKey: "Itinerary:7",
    };
    expect(importRowReplayKey(input)).toBe(importRowReplayKey(input));
    expect(importRowReplayKey(input)).not.toBe(importRowReplayKey({
      ...input,
      decisionScope: "override:00000000-0000-4000-8000-000000000007",
    }));
    expect(importOverrideScope("00000000-0000-4000-8000-000000000007"))
      .toBe("override:00000000-0000-4000-8000-000000000007");
  });

  test("only confirmed or importing jobs may commit, and cancellation is terminal-safe", () => {
    expect(() => assertImportCommitCanStart("confirmation_required")).not.toThrow();
    expect(() => assertImportCommitCanStart("ready_to_import")).not.toThrow();
    expect(() => assertImportCommitCanStart("completed")).toThrow(/already finished/iu);
    expect(() => assertImportCommitCancelable("confirmation_required")).not.toThrow();
    expect(() => assertImportCommitCancelable("cancelled")).not.toThrow();
    expect(() => assertImportCommitCancelable("completed")).toThrow(/cancellable/iu);
  });
});
