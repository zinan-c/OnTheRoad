import { describe, expect, test } from "vitest";

import { hashPassword } from "@on-the-road/database/password";
import { createApiApplication } from "../../src/app.js";
import { IdentityService, SessionError } from "../../src/modules/identity/index.mjs";
import type { ApiRuntime } from "../../src/runtime.js";

const APP_ORIGIN = "https://app.example.test";
const ACCOUNT = {
  id: "00000000-0000-4000-8000-000000000001",
  principalId: "local-principal-a",
  username: "adminA",
  passwordHash: "",
  role: "admin",
  status: "active",
  mustChangePassword: true,
  failedLoginCount: 0,
  lockedUntil: null,
};

async function createFixture() {
  const account = { ...ACCOUNT, passwordHash: await hashPassword("Admin_1234") };
  const sessions = new Map<string, typeof account>();
  const store = {
    account,
    failures: 0,
    changed: "",
    async findByUsername(username: string) {
      return username.toLowerCase() === "admina" ? account : null;
    },
    async recordLoginFailure() {
      store.failures += 1;
      return { failedLoginCount: store.failures, lockedUntil: null };
    },
    async recordLoginSuccess() {},
    async changePassword(_id: string, hash: string) {
      store.changed = hash;
      account.passwordHash = hash;
      account.mustChangePassword = false;
    },
  };
  const identity = new IdentityService({
    environment: "development",
    developmentIdentityEnabled: true,
    appOrigin: APP_ORIGIN,
    signingKeys: { active: { id: "key-v1", secret: "password-test-signing-key-at-least-32-bytes" } },
    accountStore: store,
    store: {
      async putSession(id: string, value: Record<string, unknown>) { sessions.set(id, value as typeof account); },
      async getSession(id: string) { return sessions.get(id) ?? null; },
      async deleteSession(id: string) { sessions.delete(id); },
      async deleteSessionsForPrincipal(_principalId: string, except?: string) {
        for (const id of sessions.keys()) if (id !== except) sessions.delete(id);
      },
      async putTransaction() {},
      async consumeTransaction() { return null; },
    },
  });
  return { identity, store };
}

describe("local password session", () => {
  test("logs in adminA with a generic invalid response and first-login flag", async () => {
    const { identity } = await createFixture();
    const result = await identity.loginWithPassword({
      username: " AdminA ",
      password: "Admin_1234",
      origin: APP_ORIGIN,
    });
    expect(result.principal).toMatchObject({ id: "local-principal-a", subject: ACCOUNT.id });
    expect(result.mustChangePassword).toBe(true);
    await expect(identity.authenticate(result.token)).rejects.toMatchObject({
      code: "PASSWORD_CHANGE_REQUIRED",
      status: 403,
    });
    await expect(identity.loginWithPassword({
      username: "adminA",
      password: "wrong-password",
      origin: APP_ORIGIN,
    })).rejects.toMatchObject({ code: "PASSWORD_AUTH_INVALID", status: 401 });
  });

  test("changes the forced password and revokes other sessions", async () => {
    const { identity, store } = await createFixture();
    const first = await identity.loginWithPassword({ username: "adminA", password: "Admin_1234", origin: APP_ORIGIN });
    const second = await identity.loginWithPassword({ username: "adminA", password: "Admin_1234", origin: APP_ORIGIN });
    await identity.changePassword({
      token: first.token,
      password: "New_Admin_1234!",
      origin: APP_ORIGIN,
    });
    expect(store.changed).toMatch(/^scrypt\$/u);
    await expect(identity.authenticate(second.token)).rejects.toBeInstanceOf(SessionError);
    await expect(identity.loginWithPassword({ username: "adminA", password: "Admin_1234", origin: APP_ORIGIN }))
      .rejects.toMatchObject({ code: "PASSWORD_AUTH_INVALID" });
    const relogin = await identity.loginWithPassword({ username: "adminA", password: "New_Admin_1234!", origin: APP_ORIGIN });
    expect(relogin.mustChangePassword).toBe(false);
  });

  test("blocks direct business API access until password change while identity routes remain available", async () => {
    const { identity } = await createFixture();
    let listCalls = 0;
    const app = await createApiApplication({
      appOrigin: APP_ORIGIN,
      identity,
      trips: {
        async listTrips() {
          listCalls += 1;
          return { items: [], nextCursor: null };
        },
      },
      referenceData: () => ({}),
      checkReadiness: async () => ({}),
      close: async () => {},
    } as unknown as ApiRuntime);
    const server = app.getHttpAdapter().getInstance();
    const login = async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/identity/password-session",
        headers: { origin: APP_ORIGIN },
        payload: { username: "adminA", password: "Admin_1234" },
      });
      expect(response.statusCode).toBe(200);
      return String(response.headers["set-cookie"]).split(";", 1)[0]!;
    };

    try {
      const firstCookie = await login();
      const secondCookie = await login();
      const logoutCookie = await login();

      const blocked = await server.inject({
        method: "GET",
        url: "/api/v1/trips",
        headers: { cookie: firstCookie },
      });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json()).toMatchObject({
        status: 403,
        code: "PASSWORD_CHANGE_REQUIRED",
      });
      expect(listCalls).toBe(0);

      const session = await server.inject({
        method: "GET",
        url: "/api/v1/identity/session",
        headers: { cookie: firstCookie },
      });
      expect(session.statusCode).toBe(200);
      expect(session.json()).toMatchObject({
        account: { username: "adminA", mustChangePassword: true },
      });

      const loggedOut = await server.inject({
        method: "DELETE",
        url: "/api/v1/identity/session",
        headers: { cookie: logoutCookie, origin: APP_ORIGIN },
      });
      expect(loggedOut.statusCode).toBe(204);

      const changed = await server.inject({
        method: "PUT",
        url: "/api/v1/identity/password",
        headers: { cookie: firstCookie, origin: APP_ORIGIN },
        payload: { password: "New_Admin_1234!" },
      });
      expect(changed.statusCode).toBe(200);
      expect(changed.json()).toMatchObject({ mustChangePassword: false });

      const allowed = await server.inject({
        method: "GET",
        url: "/api/v1/trips",
        headers: { cookie: firstCookie },
      });
      expect(allowed.statusCode).toBe(200);
      expect(listCalls).toBe(1);

      const revoked = await server.inject({
        method: "GET",
        url: "/api/v1/trips",
        headers: { cookie: secondCookie },
      });
      expect(revoked.statusCode).toBe(401);
      expect(revoked.json()).toMatchObject({ code: "SESSION_INVALID" });
    } finally {
      await app.close();
    }
  });
});
