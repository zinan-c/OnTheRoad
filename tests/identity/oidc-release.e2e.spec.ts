import assert from "node:assert/strict";
import { test } from "vitest";
import { inspectStagingIdentityReadiness } from "../../apps/api/src/modules/identity/index.mjs";

test("RELEASE-A05 real Staging IdP gate fails closed without a provider driver", async () => {
  const readiness = inspectStagingIdentityReadiness(process.env);
  if (readiness.status === "blocked") {
    assert.fail(
      `Staging identity gate blocked; missing=${readiness.missing.join(",")} invalid=${readiness.invalid.join(",")}`,
    );
  }
  const driverPath = process.env.OTR_OIDC_RELEASE_DRIVER?.trim();
  assert.ok(driverPath, "OTR_OIDC_RELEASE_DRIVER must name the approved provider-specific real-flow driver");
  const driver = await import(driverPath);
  assert.equal(typeof driver.runOidcReleaseVerification, "function");
  const result = await driver.runOidcReleaseVerification(process.env);
  for (const check of [
    "authorizationCodePkce",
    "stateNonceReplay",
    "httpsCookie",
    "logout",
    "rotation",
    "providerOutage",
    "invalidSignature",
    "ownerIsolation",
    "secretRedaction",
  ]) {
    assert.equal(result?.[check], true, `Real Staging IdP check did not pass: ${check}`);
  }
});
