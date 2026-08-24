import assert from "node:assert/strict";
import { describe, test } from "vitest";

import {
  BUSINESS_TRIP,
  CANDIDATE_RULE_SQL,
  EXECUTE_CONFIRMATION,
  REQUIRED_DELETE_COUNT,
  STRONG_RULE_SQL,
  idSetSha256,
  parseCleanupOptions,
  validateManifest,
} from "../../scripts/cleanup-e2e-trips.mjs";

const ids = Array.from({ length: REQUIRED_DELETE_COUNT }, (_, index) =>
  `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
const hash = idSetSha256(ids);
const preserved = [
  { id: "10000000-0000-4000-8000-000000000001", name: "Shanghai and Zhoushan" },
  { id: "10000000-0000-4000-8000-000000000002", name: "Shanghai and Zhoushan" },
  BUSINESS_TRIP,
];

function argv(...extra) {
  return [
    "--id-file=/private/tmp/ids.json",
    `--expected-count=${REQUIRED_DELETE_COUNT}`,
    `--expected-id-sha256=${hash}`,
    "--expected-database=on_the_road_local",
    "--expected-database-oid=16384",
    ...extra,
  ];
}

function manifest(overrides = {}) {
  return {
    database: { host: "127.0.0.1", port: "15432", name: "on_the_road_local", oid: "16384" },
    counts: { totalTrips: 487, candidates: 486, strong: 484, weakPreserved: 2, businessPreserved: 1 },
    strongIdSha256: hash,
    strongIds: ids,
    preserved,
    ...overrides,
  };
}

describe("E2E Trip cleanup fail-closed guard", () => {
  test("defaults to dry-run and requires every expected identity value", () => {
    const options = parseCleanupOptions(argv());
    assert.equal(options.execute, false);
    assert.equal(options.expectedCount, 484);
    assert.throws(() => parseCleanupOptions(argv().filter((value) => !value.startsWith("--expected-database-oid="))), /required/u);
    assert.throws(() => parseCleanupOptions(argv("--expected-count=483")), /Duplicate/u);
  });

  test("requires the exact destructive confirmation token", () => {
    assert.throws(() => parseCleanupOptions(argv("--execute")), /requires --confirm/u);
    assert.throws(() => parseCleanupOptions(argv("--execute", "--confirm=DELETE_ALL")), /requires --confirm/u);
    assert.equal(parseCleanupOptions(argv("--execute", `--confirm=${EXECUTE_CONFIRMATION}`)).execute, true);
  });

  test("validates the exact sorted ID set, database identity, and three preserved Trips", () => {
    const options = parseCleanupOptions(argv());
    const validated = validateManifest(manifest(), options);
    assert.equal(validated.ids.length, 484);
    assert.equal(validated.hash, hash);
    assert.throws(() => validateManifest(manifest({ strongIds: ids.slice(1) }), options), /count mismatch/u);
    assert.throws(() => validateManifest(manifest({ strongIdSha256: "0".repeat(64) }), options), /SHA-256/u);
    assert.throws(() => validateManifest(manifest({ counts: { totalTrips: 486 } }), options), /preflight counts/u);
    assert.throws(() => validateManifest(manifest({ preserved: preserved.slice(1) }), options), /exact three/u);
  });

  test("keeps weak Shanghai fixtures and the business Trip outside strong rules", () => {
    assert.doesNotMatch(STRONG_RULE_SQL, /Shanghai and Zhoushan/u);
    assert.match(CANDIDATE_RULE_SQL, /Shanghai and Zhoushan/u);
    assert.equal(BUSINESS_TRIP.id, "d9221038-a450-4f34-a33d-e78ed987be0f");
  });
});
