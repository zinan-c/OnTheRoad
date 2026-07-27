import assert from "node:assert/strict";
import { test } from "vitest";

import provider from "../../../spikes/provider/reports/A08.json" with { type: "json" };
import map from "../../../spikes/maplibre/reports/A09.json" with { type: "json" };
import importer from "../../../spikes/importer/reports/A10.json" with { type: "json" };
import pdf from "../../../spikes/pdf/reports/A11.json" with { type: "json" };

const reports = [provider, map, importer, pdf];

test("TC-M0-INT-02 every spike has thresholds, GO and an explicit Plan B", () => {
  for (const report of reports) {
    assert.ok(
      report.thresholds && Object.keys(report.thresholds).length > 0,
      `${report.taskId} has no thresholds`,
    );
    assert.match(
      report.conclusion,
      /^GO(?:\b|$)/iu,
      `${report.taskId} conclusion is unknown or NO-GO`,
    );
    assert.ok(report.planB?.trim(), `${report.taskId} has no Plan B`);
    assert.ok(
      Object.values(report.cases).every((result) => result === "passed"),
      `${report.taskId} contains an incomplete case`,
    );
  }

  assert.ok(
    provider.measurements.pointCount >= provider.thresholds.minimumGoldenPoints,
  );
  assert.ok(
    provider.measurements.maxCoordinateErrorMeters
      <= provider.thresholds.maxCoordinateErrorMeters,
  );
  assert.ok(
    map.measurements.renderedRouteFeatureCount
      >= map.thresholds.minimumRenderedRouteFeatures,
  );
  assert.equal(map.routeModes.length, map.thresholds.exactRouteModeCount);
  assert.ok(
    map.degradedStates.length >= map.thresholds.minimumDegradedStateCount,
  );
  assert.ok(
    Math.max(
      importer.measurements.csvP95Ms,
      importer.measurements.xlsBiff8P95Ms,
      importer.measurements.xlsxP95Ms,
    ) <= importer.thresholds.maxP95MsPerFormat,
  );
  assert.ok(
    importer.measurements.maxRssBytes <= importer.thresholds.maxRssBytes,
  );
  assert.equal(pdf.measurements.pageCount, pdf.thresholds.exactPageCount);
  assert.equal(pdf.measurements.blankPages, pdf.thresholds.maximumBlankPages);
  assert.equal(pdf.measurements.clippedPages, pdf.thresholds.maximumClippedPages);
});
