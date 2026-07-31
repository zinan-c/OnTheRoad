import assert from "node:assert/strict";
import { test } from "vitest";
import { IdentityConfigurationError } from "../../src/modules/identity/index.mjs";
import { createIdentityService } from "../../src/modules/identity/runtime.mjs";

const base = {
  OTR_APP_ORIGIN: "https://app.example.test",
  OTR_SESSION_SIGNING_KEY_ID: "key-v1",
  OTR_SESSION_SIGNING_KEY: "test-signing-key-v1-at-least-32-bytes",
  OTR_DEV_IDENTITY_ENABLED: "true",
};

test.each(["staging", "production"])(
  "TC-A05-02 development identity fails closed in %s",
  (environment) => {
    assert.throws(
      () => createIdentityService({ ...base, NODE_ENV: environment }),
      (error) =>
        error instanceof IdentityConfigurationError
        && error.code === "DEVELOPMENT_IDENTITY_FORBIDDEN"
        && !error.message.includes(base.OTR_SESSION_SIGNING_KEY),
    );
  },
);

test("TC-A05-02 development identity is explicit and development-only", async () => {
  const disabled = createIdentityService({
    ...base,
    NODE_ENV: "development",
    OTR_DEV_IDENTITY_ENABLED: "false",
  });
  await assert.rejects(
    async () =>
      disabled.loginWithDevelopmentIdentity({
        subject: "user-a",
        origin: base.OTR_APP_ORIGIN,
      }),
    /disabled/u,
  );
});
