import { expect, test } from "vitest";

import { geoGolden } from "./fixtures/geo-golden.js";
import { startMockHere } from "./fixtures/mock-here.js";
import candidateReport from "./reports/A08.json" with { type: "json" };
import { HereAdapter, runProviderSpike } from "./src/index.js";

test("TC-A08-03 repeatable local fixture produces stable Go/No-Go evidence", async () => {
  const mock = await startMockHere();
  try {
    const createAdapter = () => new HereAdapter({
      geocodeEndpoint: mock.geocodeEndpoint,
      discoverEndpoint: mock.discoverEndpoint,
      reverseGeocodeEndpoint: mock.reverseGeocodeEndpoint,
      profile: "fixture-cn",
      language: "zh-CN",
      apiKey: "fixture-key",
      fetchImplementation: mock.fetchImplementation
    });
    const first = await runProviderSpike(createAdapter(), "fixture-cn", geoGolden);
    const second = await runProviderSpike(createAdapter(), "fixture-cn", geoGolden);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      caseId: "TC-A08-03",
      pointCount: 12,
      domainCrs: "WGS84",
      conclusion: "GO",
      thresholds: {
        maxCoordinateErrorMeters: 3,
        minimumGoldenPoints: 10
      }
    });
    expect(first.attribution).toEqual(["© HERE"]);
    expect(first.planB).toContain("never silently switch");
    expect(candidateReport.thresholds).toEqual(first.thresholds);
    expect(candidateReport.measurements).toEqual({
      pointCount: first.pointCount,
      maxCoordinateErrorMeters: first.maxCoordinateErrorMeters,
      searchCandidateCount: first.searchCandidateCount,
      ambiguousCandidateCount: first.ambiguousCandidateCount
    });
    expect(candidateReport.evidenceSha256).toBe(first.evidenceSha256);
    expect(candidateReport.conclusion).toBe(first.conclusion);
  } finally {
    await mock.close();
  }
});
