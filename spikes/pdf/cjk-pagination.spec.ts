import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { generateSpikePdf, inspectPdf } from "./src/spike.ts";

test("TC-A11-01 renders a parseable 50-page CJK document", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "otr-a11-cjk-"));
  const result = await generateSpikePdf({ outputDir });
  const inspection = await inspectPdf(result.pdfPath);

  assert.equal(inspection.pageCount, 50);
  assert.match(inspection.text, /上海到舟山/);
  assert.match(inspection.text, /On The Road · PDF Spike Header/);
  assert.equal(inspection.headerOccurrences, 50);
  assert.equal(inspection.footerOccurrences, 50);
  assert.ok(inspection.fontNames.some((name) => /NotoSansCJKsc/i.test(name)));
  assert.ok(inspection.pageWidthPoints < inspection.pageHeightPoints);

  const landscapeDir = await mkdtemp(path.join(os.tmpdir(), "otr-a11-landscape-"));
  const landscape = await generateSpikePdf({
    outputDir: landscapeDir,
    orientation: "landscape",
  });
  const landscapeInspection = await inspectPdf(landscape.pdfPath);
  assert.equal(landscapeInspection.pageCount, 50);
  assert.ok(landscapeInspection.pageWidthPoints > landscapeInspection.pageHeightPoints);
  assert.match(landscapeInspection.text, /上海到舟山/);
});
