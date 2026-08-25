import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  DatabaseMigrator,
  createDatabasePool,
  discoverMigrations,
} from "../src/migration/index.js";
import { seedSystemReferenceData } from "../src/seed.js";

const databaseUrl = process.env.OTR_DATABASE_MIGRATION_TEST_URL;
const liveTest = databaseUrl ? test : test.skip;
const schema = `seed_identity_${randomUUID().replaceAll("-", "")}`;
const adminPool = databaseUrl ? createDatabasePool(databaseUrl) : undefined;
const pool = databaseUrl
  ? createDatabasePool(databaseUrl, { options: `-c search_path=${schema},public` })
  : undefined;

describe("bootstrap admin seed", () => {
  beforeAll(async () => {
    if (!adminPool || !pool) return;
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    await new DatabaseMigrator({
      pool,
      migrations: await discoverMigrations(),
    }).migrate();
  });

  afterAll(async () => {
    await pool?.end();
    if (!adminPool) return;
    await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
    await adminPool.end();
  });

  liveTest("is concurrent-safe and never resets changed credentials or the first-login flag", async () => {
    const [first, second] = await Promise.all([
      seedSystemReferenceData(pool!),
      seedSystemReferenceData(pool!),
    ]);

    expect([first.bootstrapAdmin.created, second.bootstrapAdmin.created].sort()).toEqual([false, true]);
    expect(first.adminAccounts).toBe(1);
    expect(second.adminAccounts).toBe(1);
    expect(first.bootstrapAdmin).toMatchObject({
      username: "adminA",
      mustChangePassword: true,
    });

    const initial = await pool!.query<{
      id: string;
      password_hash: string;
      created_at: string;
    }>(
      `UPDATE user_account
          SET password_hash = 'preserved-password-hash-value-000001',
              must_change_password = false
        WHERE username_normalized = 'admina'
      RETURNING id, password_hash, created_at`,
    );
    const rerun = await seedSystemReferenceData(pool!, {
      OTR_BOOTSTRAP_ADMIN_USERNAME: " AdminA ",
      OTR_BOOTSTRAP_ADMIN_PASSWORD: "Different_1234!",
      OTR_BOOTSTRAP_ADMIN_FORCE_PASSWORD_CHANGE: "true",
    });
    const after = await pool!.query<{
      id: string;
      password_hash: string;
      created_at: string;
      must_change_password: boolean;
    }>(
      `SELECT id, password_hash, created_at, must_change_password
         FROM user_account
        WHERE username_normalized = 'admina'`,
    );

    expect(rerun.bootstrapAdmin).toEqual({
      id: initial.rows[0]!.id,
      username: "adminA",
      role: "admin",
      status: "active",
      mustChangePassword: false,
      created: false,
    });
    expect(after.rows[0]).toMatchObject({
      id: initial.rows[0]!.id,
      password_hash: "preserved-password-hash-value-000001",
      created_at: initial.rows[0]!.created_at,
      must_change_password: false,
    });
  }, 30_000);
});
