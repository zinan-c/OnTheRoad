import { describe, expect, test } from "vitest";

import {
  importOverrideScope,
  importRowReplayKey,
} from "@on-the-road/application/import/commit";

describe("TC-E08-01 exact replay/fingerprint contract", () => {
  test("same source row replays exactly while a deliberate override gets a new scope", () => {
    const base = {
      sourceSha256: "1".repeat(64),
      importerVersion: "runtime-1",
      mappingHash: "2".repeat(64),
      sourceRowKey: "Itinerary:9",
    };
    const replay = importRowReplayKey(base);
    expect(importRowReplayKey({ ...base })).toBe(replay);
    expect(importRowReplayKey({
      ...base,
      decisionScope: importOverrideScope("00000000-0000-4000-8000-000000000009"),
    })).not.toBe(replay);
  });
});
