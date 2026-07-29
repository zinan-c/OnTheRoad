import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe } from "vitest";

import { CandidateTokenSigner } from "../../../../packages/domain/src/location/index.mjs";
import {
  LocationService,
  PostgresLocationRepository,
} from "../../src/modules/locations/index.mjs";
import {
  cleanTrip,
  liveLocationTest,
  locationDatabaseUrl,
  prepareLocationDatabase,
} from "./postgres-harness.mjs";

const ownerId = `tc-c03-api-owner-${randomUUID()}`;
let tripId: string | undefined;
let service: LocationService;

const bund = {
  label: "外滩",
  formattedAddress: "上海市黄浦区中山东一路",
  providerPlaceId: "fixture:bund",
  attribution: "fixture",
  countryCode: "CN",
  city: "上海",
  district: "黄浦区",
  point: { longitude: 121.4903, latitude: 31.2411, crs: "WGS84" },
  confidence: 0.95,
};

const pudong = {
  ...bund,
  label: "浦东候选",
  providerPlaceId: "fixture:pudong",
  point: { longitude: 121.5447, latitude: 31.2215, crs: "WGS84" },
};

beforeAll(async () => {
  if (!locationDatabaseUrl) return;
  tripId = await prepareLocationDatabase(ownerId);
  service = new LocationService({
    repository: new PostgresLocationRepository({
      databaseUrl: locationDatabaseUrl,
    }),
    candidateSigner: new CandidateTokenSigner({
      secret: "tc-c03-api-candidate-secret-at-least-32",
    }),
  });
});

afterAll(async () => {
  await cleanTrip(tripId);
});

describe("TC-C03-03 State replay and version CAS", () => {
  liveLocationTest("replays ambiguous, resolved and failed facts after reload", async () => {
    const ambiguous = await service.create(ownerId, tripId, {
      inputText: "外滩",
    });
    const started = await service.beginResolving(
      ownerId,
      ambiguous.id,
      ambiguous.version,
      { provider: "fixture" },
    );
    const ambiguousResult = await service.applyResult(ownerId, started.job.id, {
      status: "ambiguous",
      candidates: [bund, pudong],
    });
    assert.equal(ambiguousResult.location.status, "ambiguous");
    assert.equal(ambiguousResult.job.candidates.length, 2);

    const selected = await service.selectCandidate(
      ownerId,
      started.job.id,
      ambiguousResult.job.candidates[0],
      ambiguousResult.location.version,
    );
    assert.equal(selected.status, "resolved");
    assert.deepEqual(selected.point, bund.point);
    assert.deepEqual(await service.get(ownerId, ambiguous.id), selected);

    const failed = await service.create(ownerId, tripId, {
      inputText: "不存在的地点",
    });
    const failedJob = await service.beginResolving(
      ownerId,
      failed.id,
      failed.version,
      { provider: "fixture" },
    );
    const failedResult = await service.applyResult(ownerId, failedJob.job.id, {
      status: "failed",
      errorCode: "NO_RESULTS",
    });
    assert.equal(failedResult.location.status, "failed");
    assert.equal((await service.get(ownerId, failed.id)).status, "failed");
  });

  liveLocationTest("CAS accepts one concurrent result and rejects stale geocoding after manual adjustment", async () => {
    const racing = await service.create(ownerId, tripId, {
      inputText: "并发地点",
    });
    const raceJob = await service.beginResolving(
      ownerId,
      racing.id,
      racing.version,
      { provider: "fixture" },
    );
    const outcomes = await Promise.allSettled([
      service.applyResult(ownerId, raceJob.job.id, {
        status: "resolved",
        candidate: bund,
      }),
      service.applyResult(ownerId, raceJob.job.id, {
        status: "resolved",
        candidate: pudong,
      }),
    ]);
    assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(outcomes.filter(({ status }) => status === "rejected").length, 1);
    assert.equal((await service.get(ownerId, racing.id)).status, "resolved");

    const manual = await service.create(ownerId, tripId, {
      inputText: "稍后人工修改",
    });
    const oldJob = await service.beginResolving(
      ownerId,
      manual.id,
      manual.version,
      { provider: "fixture" },
    );
    const adjusted = await service.manuallyAdjust(
      ownerId,
      manual.id,
      oldJob.location.version,
      { longitude: 120.1, latitude: 30.2, crs: "WGS84" },
    );
    assert.equal(adjusted.manuallyAdjusted, true);
    await assert.rejects(
      service.applyResult(ownerId, oldJob.job.id, {
        status: "resolved",
        candidate: bund,
      }),
      /version conflict|stale geocoding/u,
    );
    assert.deepEqual((await service.get(ownerId, manual.id)).point, {
      longitude: 120.1,
      latitude: 30.2,
      crs: "WGS84",
    });
  });
});
