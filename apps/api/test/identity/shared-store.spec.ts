import assert from "node:assert/strict";
import { test } from "vitest";

import {
  IdentityService,
  MockOidcProvider,
  RedisIdentityStore,
  SessionError,
} from "../../src/modules/identity/index.mjs";

class FakeRedis {
  readonly values = new Map<string, string>();

  async set(key: string, value: string) {
    this.values.set(key, value);
    return "OK";
  }

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async del(key: string) {
    return this.values.delete(key) ? 1 : 0;
  }

  async getdel(key: string) {
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return value;
  }
}

const options = {
  environment: "development",
  developmentIdentityEnabled: true,
  appOrigin: "https://app.example.test",
  signingKeys: {
    active: {
      id: "shared-v1",
      secret: "shared-store-test-secret-at-least-32-characters",
    },
  },
};

test("REVIEW-P1-06 sessions and one-time OIDC transactions survive instance changes", async () => {
  const redis = new FakeRedis();
  const first = new IdentityService({
    ...options,
    store: new RedisIdentityStore(redis),
  });
  const second = new IdentityService({
    ...options,
    store: new RedisIdentityStore(redis),
  });

  const login = await first.loginWithDevelopmentIdentity({
    subject: "shared-user",
    origin: options.appOrigin,
  });
  assert.equal((await second.authenticate(login.token)).subject, "shared-user");

  const provider = new MockOidcProvider({ issuer: "https://idp.example.test" });
  const flow = await first.beginOidcAuthorization({ provider });
  const code = provider.issueCode({
    subject: "shared-user",
    nonce: flow.nonce,
    codeChallenge: flow.codeChallenge,
  });
  await second.completeOidcAuthorization({
    provider,
    code,
    state: flow.state,
    transactionCookie: flow.transactionCookie,
    origin: options.appOrigin,
  });
  await assert.rejects(
    first.completeOidcAuthorization({
      provider,
      code,
      state: flow.state,
      transactionCookie: flow.transactionCookie,
      origin: options.appOrigin,
    }),
    /state/u,
  );

  await second.logout({ token: login.token, origin: options.appOrigin });
  await assert.rejects(first.authenticate(login.token), SessionError);
});
