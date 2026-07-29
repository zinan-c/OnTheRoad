import assert from "node:assert/strict";
import { test } from "vitest";
import { inspectStagingIdentityReadiness } from "../../apps/api/src/modules/identity/index.mjs";

test("TC-A05-03 real Staging IdP release gate is explicit", () => {
  const readiness = inspectStagingIdentityReadiness(process.env);
  if (readiness.status === "blocked") {
    assert.ok(readiness.missing.length > 0);
    return;
  }

  throw new Error(
    "Staging IdP configuration is present. Run the approved interactive real-provider smoke before release; this offline suite must not claim it passed.",
  );
});
