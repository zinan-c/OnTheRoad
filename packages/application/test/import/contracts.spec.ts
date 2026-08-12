import { describe, expect, test } from "vitest";

import {
  assertGeocodingBatchProgress,
  assertGeocodingBatchTransition,
  assertStagedLocationDecision,
  geocodingBatchProgressPercent,
  isTerminalGeocodingBatchStatus,
} from "../../src/import/contracts.js";

describe("M4 Wave0 import contracts", () => {
  test("progress accounts for every geocoding unit and reaches 100 only when settled", () => {
    const progress = {
      totalUnits: 4,
      queuedUnits: 1,
      resolvingUnits: 1,
      resolvedUnits: 1,
      ambiguousUnits: 1,
      failedUnits: 0,
      cancelledUnits: 0,
    };

    assertGeocodingBatchProgress(progress);
    expect(geocodingBatchProgressPercent(progress)).toBe(50);
    expect(isTerminalGeocodingBatchStatus("completed_with_warnings")).toBe(true);
    expect(isTerminalGeocodingBatchStatus("running")).toBe(false);
    expect(() => assertGeocodingBatchProgress({ ...progress, totalUnits: 5 })).toThrow();
  });

  test("batch state machine permits cancellation and forbids leaving terminal states", () => {
    expect(() => assertGeocodingBatchTransition("queued", "running")).not.toThrow();
    expect(() => assertGeocodingBatchTransition("running", "cancelling")).not.toThrow();
    expect(() => assertGeocodingBatchTransition("completed", "running")).toThrow();
  });

  test("staged decisions bind the source to the decision type", () => {
    const decision = {
      id: "decision-1",
      tripId: "trip-1",
      importStagingId: "staging-1",
      actorId: "owner-1",
      decisionType: "candidate" as const,
      source: "provider_candidate" as const,
      decisionVersion: 1,
      candidateTokenHash: "a".repeat(64),
      payload: { candidateId: "provider:place-1" },
      createdAt: "2026-08-12T00:00:00.000Z",
    };

    expect(() => assertStagedLocationDecision(decision)).not.toThrow();
    expect(() => assertStagedLocationDecision({
      ...decision,
      source: "map_click",
    })).toThrow();
  });
});
