import { describe, expect, test } from "vitest";
import type { Pool } from "pg";

import { seedSystemReferenceData } from "../src/seed.js";

function poolFixture(options: { readonly initiallyExists: boolean; readonly role?: string }) {
  const queries: string[] = [];
  const admin = {
    id: "00000000-0000-4000-8000-000000000001",
    username: "adminA",
    role: options.role ?? "admin",
    status: "active",
    must_change_password: false,
  };
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("SELECT id FROM user_account")) {
        return options.initiallyExists
          ? { rowCount: 1, rows: [{ id: admin.id }] }
          : { rowCount: 0, rows: [] };
      }
      if (sql.includes("INSERT INTO user_account")) {
        // Simulate another transaction winning the normalized username race.
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("SELECT id, username, role, status, must_change_password")) {
        return { rowCount: 1, rows: [admin] };
      }
      if (sql.includes("SELECT count(*)::int AS count")) {
        return { rowCount: 1, rows: [{ count: 2 }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  return {
    queries,
    pool: { async connect() { return client; } } as unknown as Pool,
  };
}

describe("seedSystemReferenceData", () => {
  test("reports actual existing admin state without rewriting credentials", async () => {
    const fixture = poolFixture({ initiallyExists: true });

    await expect(seedSystemReferenceData(fixture.pool)).resolves.toMatchObject({
      adminAccounts: 2,
      bootstrapAdmin: {
        id: "00000000-0000-4000-8000-000000000001",
        username: "adminA",
        role: "admin",
        status: "active",
        mustChangePassword: false,
        created: false,
      },
    });
    expect(fixture.queries.some((sql) => sql.includes("INSERT INTO user_account"))).toBe(false);
  });

  test("treats a concurrent normalized-username insert as an idempotent success", async () => {
    const fixture = poolFixture({ initiallyExists: false });

    await expect(seedSystemReferenceData(fixture.pool)).resolves.toMatchObject({
      adminAccounts: 2,
      bootstrapAdmin: {
        id: "00000000-0000-4000-8000-000000000001",
        created: false,
      },
    });
    expect(fixture.queries.find((sql) => sql.includes("INSERT INTO user_account")))
      .toContain("ON CONFLICT DO NOTHING");
  });

  test("fails closed when the bootstrap username belongs to a non-admin account", async () => {
    const fixture = poolFixture({ initiallyExists: true, role: "member" });

    await expect(seedSystemReferenceData(fixture.pool)).rejects.toThrow(
      "Bootstrap admin username belongs to an account that is not an active admin.",
    );
    expect(fixture.queries.at(-1)).toBe("ROLLBACK");
  });
});
