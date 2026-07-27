import { coordinateErrorMeters, toWgs84, type Coordinate, type Crs } from "./coordinates.js";
import { HereAdapter } from "./provider.js";

interface GoldenPoint {
  id: string;
  sourceCrs: Crs;
  source: Coordinate;
  expectedWgs84: Coordinate;
}

export interface ProviderSpikeReport {
  caseId: "TC-A08-03";
  profile: string;
  pointCount: number;
  maxCoordinateErrorMeters: number;
  searchCandidateCount: number;
  ambiguousCandidateCount: number;
  reverseLabel: string;
  attribution: string[];
  domainCrs: "WGS84";
  thresholds: {
    maxCoordinateErrorMeters: number;
    minimumGoldenPoints: number;
  };
  conclusion: "GO" | "NO-GO";
  planB: string;
  evidenceSha256: string;
}

export async function runProviderSpike(
  adapter: HereAdapter,
  profile: string,
  points: readonly GoldenPoint[],
): Promise<ProviderSpikeReport> {
  const errors = points.map((point) =>
    coordinateErrorMeters(toWgs84(point.source, point.sourceCrs), point.expectedWgs84),
  );
  const search = await adapter.search({ query: "外滩", context: { countryCodes: ["CHN"] } });
  const ambiguous = await adapter.search({ query: "Springfield" });
  const reverse = await adapter.reverse({ longitude: 121.4906, latitude: 31.2413, crs: "WGS84" });
  const attribution = [...new Set([...search, ...ambiguous, reverse].map((candidate) => candidate.attribution))].sort();
  const thresholds = { maxCoordinateErrorMeters: 3, minimumGoldenPoints: 10 };
  const maxCoordinateErrorMeters = Math.max(...errors);
  const conclusion = points.length >= thresholds.minimumGoldenPoints
    && maxCoordinateErrorMeters <= thresholds.maxCoordinateErrorMeters
    && [...search, ...ambiguous, reverse].every((candidate) => candidate.coordinate.crs === "WGS84")
    && attribution.length > 0
    ? "GO"
    : "NO-GO";
  const evidence = {
    profile,
    points: points.map((point, index) => ({ id: point.id, errorMeters: Number(errors[index]!.toFixed(6)) })),
    search,
    ambiguous,
    reverse,
    attribution
  };
  const evidenceBytes = new TextEncoder().encode(JSON.stringify(evidence));
  const digest = await crypto.subtle.digest("SHA-256", evidenceBytes);
  const evidenceSha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return {
    caseId: "TC-A08-03",
    profile,
    pointCount: points.length,
    maxCoordinateErrorMeters: Number(maxCoordinateErrorMeters.toFixed(6)),
    searchCandidateCount: search.length,
    ambiguousCandidateCount: ambiguous.length,
    reverseLabel: reverse.label,
    attribution,
    domainCrs: "WGS84",
    thresholds,
    conclusion,
    planB: "Use the offline fixture provider and explicit map picking/manual WGS84 coordinates; never silently switch providers.",
    evidenceSha256
  };
}
