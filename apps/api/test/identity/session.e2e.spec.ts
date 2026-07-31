import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  IdentityService,
  MockOidcProvider,
  SessionError,
} from "../../src/modules/identity/index.mjs";

const NOW = Date.parse("2026-07-29T00:00:00.000Z");
const APP_ORIGIN = "https://app.example.test";

function createService() {
  return new IdentityService({
    environment: "development",
    developmentIdentityEnabled: true,
    appOrigin: APP_ORIGIN,
    sessionTtlMs: 60_000,
    transactionTtlMs: 30_000,
    clock: () => NOW,
    signingKeys: {
      active: { id: "key-v1", secret: "test-signing-key-v1-at-least-32-bytes" },
    },
  });
}

describe("TC-A05-01 Login/session contract", () => {
  test("development identity issues and clears a hardened session cookie", async () => {
    const service = createService();
    const login = await service.loginWithDevelopmentIdentity({
      subject: "user-a",
      origin: APP_ORIGIN,
    });

    assert.equal(login.principal.subject, "user-a");
    assert.match(login.setCookie, /HttpOnly/u);
    assert.match(login.setCookie, /Secure/u);
    assert.match(login.setCookie, /SameSite=Lax/u);
    assert.doesNotMatch(login.setCookie, /test-signing-key/u);
    assert.equal((await service.authenticate(login.token)).subject, "user-a");

    service.setClock(() => NOW + 60_001);
    await assert.rejects(service.authenticate(login.token), /invalid/u);
    service.setClock(() => NOW);

    const logout = await service.logout({ token: login.token, origin: APP_ORIGIN });
    assert.match(logout.setCookie, /Max-Age=0/u);
    await assert.rejects(service.authenticate(login.token), SessionError);
  });

  test("mock OIDC enforces PKCE, state, nonce and transaction expiry", async () => {
    const service = createService();
    const provider = new MockOidcProvider({ issuer: "https://idp.example.test" });
    const flow = await service.beginOidcAuthorization({ provider });

    await assert.rejects(
      service.completeOidcAuthorization({
        provider,
        code: provider.issueCode({
          subject: "user-a",
          nonce: flow.nonce,
          codeChallenge: flow.codeChallenge,
        }),
        state: "wrong-state",
        transactionCookie: flow.transactionCookie,
        origin: APP_ORIGIN,
      }),
      /state/u,
    );

    const secondFlow = await service.beginOidcAuthorization({ provider });
    await assert.rejects(
      service.completeOidcAuthorization({
        provider,
        code: provider.issueCode({
          subject: "user-a",
          nonce: "wrong-nonce",
          codeChallenge: secondFlow.codeChallenge,
        }),
        state: secondFlow.state,
        transactionCookie: secondFlow.transactionCookie,
        origin: APP_ORIGIN,
      }),
      /nonce/u,
    );

    const successfulFlow = await service.beginOidcAuthorization({ provider });
    const successfulCode = provider.issueCode({
      subject: "user-a",
      nonce: successfulFlow.nonce,
      codeChallenge: successfulFlow.codeChallenge,
    });
    const result = await service.completeOidcAuthorization({
      provider,
      code: successfulCode,
      state: successfulFlow.state,
      transactionCookie: successfulFlow.transactionCookie,
      origin: APP_ORIGIN,
    });
    assert.equal(result.principal.subject, "user-a");
    assert.match(result.clearTransactionCookie, /Max-Age=0/u);
    await assert.rejects(
      service.completeOidcAuthorization({
        provider,
        code: successfulCode,
        state: successfulFlow.state,
        transactionCookie: successfulFlow.transactionCookie,
        origin: APP_ORIGIN,
      }),
      /state/u,
    );

    const expired = createService();
    const expiredFlow = await expired.beginOidcAuthorization({ provider });
    expired.setClock(() => NOW + 30_001);
    await assert.rejects(
      expired.completeOidcAuthorization({
        provider,
        code: provider.issueCode({
          subject: "user-a",
          nonce: expiredFlow.nonce,
          codeChallenge: expiredFlow.codeChallenge,
        }),
        state: expiredFlow.state,
        transactionCookie: expiredFlow.transactionCookie,
        origin: APP_ORIGIN,
      }),
      /expired/u,
    );
  });
});
