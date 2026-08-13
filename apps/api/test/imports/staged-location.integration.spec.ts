import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import { PostgresImportUnresolvedLocationService } from "../../src/modules/imports/unresolved.mjs";

const ownerId = "e07-integration-owner";
const jobId = "00000000-0000-4000-8000-000000000201";
const stagingId = "00000000-0000-4000-8000-000000000202";
const rowId = "00000000-0000-4000-8000-000000000203";
const tripId = "00000000-0000-4000-8000-000000000204";

const candidate = {
  id: "fixture:people-square",
  label: "人民广场",
  formattedAddress: "上海市黄浦区人民大道人民广场",
  countryCode: "CN",
  city: "上海",
  district: "黄浦区",
  providerScore: 1,
  provider: "fixture",
  attribution: "On The Road fixture",
  point: { longitude: 121.4737, latitude: 31.2304, crs: "WGS84" },
};

class FakeCandidateSigner {
  readonly signed: Array<Record<string, unknown>> = [];

  sign(input: Record<string, unknown>): string {
    this.signed.push(input);
    return "candidate-token";
  }

  verify(token: string): Record<string, unknown> {
    if (token !== "candidate-token") {
      throw Object.assign(new Error("Candidate token expired."), {
        code: "CANDIDATE_TOKEN_EXPIRED",
        status: 410,
      });
    }
    return {
      label: candidate.label,
      formattedAddress: candidate.formattedAddress,
      countryCode: candidate.countryCode,
      city: candidate.city,
      district: candidate.district,
      confidence: candidate.providerScore,
      provider: candidate.provider,
      attribution: candidate.attribution,
      providerPlaceId: candidate.id,
      point: candidate.point,
    };
  }
}

function database() {
  const queries: Array<{ text: string; values: readonly unknown[] }> = [];
  let decisionVersion = 0;
  const row = {
    id: stagingId,
    trip_id: tripId,
    owner_id: ownerId,
    source_row_key: "Sheet 1:2",
    staged_location: { inputText: "人民广场", candidates: [candidate] },
    status: "staged",
    version: 1,
    import_row_id: rowId,
    row_status: "unresolved",
  };
  const client = {
    async query(text: string, values: readonly unknown[] = []) {
      queries.push({ text, values });
      if (text.includes("SELECT s.id, s.trip_id, s.owner_id")) return { rows: [row] };
      if (text.includes("SELECT COALESCE((")) return { rows: [{ version: decisionVersion + 1 }] };
      if (text.includes("INSERT INTO staged_location_decision")) {
        decisionVersion += 1;
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  return {
    queries,
    async query(text: string, values: readonly unknown[] = []) {
      queries.push({ text, values });
      if (text.includes("SELECT s.id, s.trip_id, s.source_row_key")) return { rows: [row] };
      return { rows: [] };
    },
    async transaction<T>(operation: (value: typeof client) => Promise<T>) {
      return operation(client);
    },
  };
}

describe("TC-E07-01 staged location decisions", () => {
  test("supports candidate, map, manual-coordinate and text-only decisions without formal writes", async () => {
    const db = database();
    const signer = new FakeCandidateSigner();
    const service = new PostgresImportUnresolvedLocationService({
      database: db,
      candidateSigner: signer,
    });

    const listed = await service.list(ownerId, jobId);
    expect(listed).toMatchObject([{
      id: stagingId,
      status: "staged",
      inputText: "人民广场",
      candidates: [{ label: "人民广场", candidateToken: "candidate-token" }],
    }]);

    const decisions = [
      { type: "candidate", candidateToken: "candidate-token" },
      { type: "map_point", point: { latitude: 31.2304, longitude: 121.4737 }, name: "地图点" },
      { type: "manual_coordinate", point: { latitude: 31.2305, longitude: 121.4738 }, name: "手工点" },
      { type: "accept_text", name: "纯文字地点" },
    ] as const;
    for (const input of decisions) {
      const result = await service.decide(ownerId, jobId, stagingId, input);
      expect(result).toMatchObject({
        importJobId: jobId,
        importRowId: rowId,
        stagingId,
        status: "ready",
      });
    }

    const inserted = db.queries.filter(({ text }) => text.includes("INSERT INTO staged_location_decision"));
    expect(inserted).toHaveLength(4);
    expect(inserted.map(({ values }) => values.slice(3, 7))).toEqual([
      [ownerId, "candidate", "provider_candidate", 1],
      [ownerId, "map_point", "map_click", 2],
      [ownerId, "manual_coordinate", "manual_coordinate", 3],
      [ownerId, "accept_text", "text_only", 4],
    ]);
    expect(String(inserted[0]?.values[7])).toBe(createHash("sha256").update("candidate-token").digest("hex"));
    expect(inserted.slice(1).every(({ values }) => values[7] === null)).toBe(true);
    expect(signer.signed).toHaveLength(1);
    expect(db.queries.some(({ text }) => /(?:INSERT|UPDATE) (?:location|itinerary_item)/u.test(text))).toBe(false);
  });

  test("rejects an expired candidate token before writing a decision", async () => {
    const db = database();
    const service = new PostgresImportUnresolvedLocationService({
      database: db,
      candidateSigner: new FakeCandidateSigner(),
    });

    await expect(service.decide(ownerId, jobId, stagingId, {
      type: "candidate",
      candidateToken: "expired-token",
    })).rejects.toMatchObject({ code: "CANDIDATE_TOKEN_EXPIRED", status: 410 });
    expect(db.queries.some(({ text }) => text.includes("INSERT INTO staged_location_decision"))).toBe(false);
  });
});
