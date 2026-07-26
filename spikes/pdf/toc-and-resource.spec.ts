import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  generateSpikePdf,
  ResourceTimeoutError,
  verifyExactToc,
} from "./src/spike.ts";

test("TC-A11-02 uses final physical pages for every TOC entry", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "otr-a11-toc-"));
  const result = await generateSpikePdf({ outputDir });
  const verification = await verifyExactToc(result.pdfPath, result.toc);

  assert.equal(verification.entries.length, result.toc.length);
  assert.deepEqual(verification.mismatches, []);
});

test("TC-A11-02 fails closed when font or map readiness times out", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "otr-a11-timeout-"));
  const pdfPath = path.join(outputDir, "trip.pdf");

  await assert.rejects(
    generateSpikePdf({
      outputDir,
      resourceTimeoutMs: 25,
      injectResourceDelayMs: 100,
    }),
    ResourceTimeoutError,
  );
  await assert.rejects(access(pdfPath));
});
