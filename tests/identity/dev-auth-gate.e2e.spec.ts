import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import {
  IdentityService,
  MockOidcProvider,
  inspectStagingIdentityReadiness,
} from "../../apps/api/src/modules/identity/index.mjs";

const NOW = Date.parse("2026-07-29T00:00:00.000Z");
const SECRET_V1 = "test-signing-key-v1-at-least-32-bytes";
const SECRET_V2 = "test-signing-key-v2-at-least-32-bytes";

test("TC-A05-03 Dev gate preserves semantics through key rotation and redacts secrets", async () => {
  const logs: string[] = [];
  const service = new IdentityService({
    environment: "development",
    developmentIdentityEnabled: true,
    appOrigin: "https://app.example.test",
    clock: () => NOW,
    signingKeys: { active: { id: "key-v1", secret: SECRET_V1 } },
    audit: (event) => logs.push(JSON.stringify(event)),
  });
  const development = service.loginWithDevelopmentIdentity({
    subject: "same-user",
    origin: "https://app.example.test",
  });
  const provider = new MockOidcProvider({
    issuer: "https://mock-idp.example.test",
    subjectNamespace: "https://dev-identity.local",
  });
  const flow = service.beginOidcAuthorization({ provider });
  const oidc = await service.completeOidcAuthorization({
    provider,
    code: provider.issueCode({
      subject: "same-user",
      nonce: flow.nonce,
      codeChallenge: flow.codeChallenge,
    }),
    state: flow.state,
    transactionCookie: flow.transactionCookie,
    origin: "https://app.example.test",
  });

  assert.deepEqual(oidc.principal, development.principal);
  service.rotateSigningKey({
    active: { id: "key-v2", secret: SECRET_V2 },
    previous: { id: "key-v1", secret: SECRET_V1 },
  });
  assert.equal(service.authenticate(development.token).id, development.principal.id);
  const afterRotation = service.loginWithDevelopmentIdentity({
    subject: "same-user",
    origin: "https://app.example.test",
  });
  assert.equal(service.authenticate(afterRotation.token).id, development.principal.id);
  assert.doesNotMatch(logs.join("\n"), new RegExp(`${SECRET_V1}|${SECRET_V2}`, "u"));
});

test("TC-A05-03 records an actionable staging handoff when real IdP config is absent", async () => {
  const readiness = inspectStagingIdentityReadiness({});
  assert.equal(readiness.status, "blocked");
  assert.deepEqual(readiness.missing, [
    "OTR_OIDC_ISSUER",
    "OTR_OIDC_CLIENT_ID",
    "OTR_OIDC_CLIENT_SECRET",
    "OTR_OIDC_CALLBACK_URL",
    "OTR_OIDC_POST_LOGOUT_REDIRECT_URL",
  ]);

  const checklist = await readFile(
    new URL("../../docs/runbooks/release-checklist.md", import.meta.url),
    "utf8",
  );
  const handoff = await readFile(
    new URL("../../docs/reports/a05-staging-idp-handoff.md", import.meta.url),
    "utf8",
  );
  assert.match(checklist, /A05 staging identity gate/u);
  for (const field of readiness.missing) assert.match(handoff, new RegExp(field, "u"));
  assert.match(handoff, /BLOCKED/u);
  assert.match(handoff, /tests\/identity\/oidc-release\.e2e\.spec\.ts/u);
});
