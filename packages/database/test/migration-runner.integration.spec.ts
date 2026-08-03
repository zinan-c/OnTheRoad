import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  DatabaseMigrationError,
  DatabaseMigrator,
  createDatabasePool,
  discoverMigrations,
  minimumCompatibleSchemaVersion,
  type Migration,
} from "../src/migration/index.js";
import { seedSystemReferenceData } from "../src/seed.js";

const databaseUrl = process.env.OTR_DATABASE_MIGRATION_TEST_URL;
const liveTest = databaseUrl ? test : test.skip;
const schema = `review_p1_02_${randomUUID().replaceAll("-", "")}`;
const adminPool = databaseUrl ? createDatabasePool(databaseUrl) : undefined;
const pool = databaseUrl
  ? createDatabasePool(databaseUrl, { options: `-c search_path=${schema},public` })
  : undefined;

describe("REVIEW-P1-02 unified migration lifecycle", () => {
  beforeAll(async () => {
    if (!adminPool) return;
    await adminPool.query(`CREATE SCHEMA ${schema}`);
  });

  afterAll(async () => {
    await pool?.end();
    if (!adminPool) return;
    await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
    await adminPool.end();
  });

  liveTest("migrates clean to previous, upgrades to latest, seeds, and stays idempotent", async () => {
    const migrations = await discoverMigrations();
    const previous = new DatabaseMigrator({
      pool: pool!,
      migrations: migrations.slice(0, -1),
      minimumCompatibleVersion: minimumCompatibleSchemaVersion - 1,
    });
    const previousStatus = await previous.migrate();
    expect(previousStatus).toMatchObject({
      currentVersion: minimumCompatibleSchemaVersion - 1,
      latestVersion: minimumCompatibleSchemaVersion - 1,
      compatible: true,
      pending: [],
      dirty: [],
    });

    const latest = new DatabaseMigrator({ pool: pool!, migrations });
    expect(await latest.migrate()).toMatchObject({
      currentVersion: minimumCompatibleSchemaVersion,
      latestVersion: minimumCompatibleSchemaVersion,
      compatible: true,
      pending: [],
      dirty: [],
    });
    expect(await latest.migrate()).toMatchObject({
      currentVersion: minimumCompatibleSchemaVersion,
      pending: [],
      dirty: [],
    });

    await expect(seedSystemReferenceData(pool!)).resolves.toMatchObject({
      currencies: 15,
      costCategories: 9,
      transportModes: 22,
    });
    await expect(seedSystemReferenceData(pool!)).resolves.toMatchObject({
      currencies: 15,
      costCategories: 9,
      transportModes: 22,
    });
    const counts = await pool!.query(
      `SELECT
         (SELECT count(*)::int FROM reference_currency) AS currencies,
         (SELECT count(*)::int FROM reference_cost_category) AS categories,
         (SELECT count(*)::int FROM reference_transport_mode) AS modes`,
    );
    expect(counts.rows[0]).toEqual({ currencies: 15, categories: 9, modes: 22 });
  }, 30_000);

  liveTest("records failure, requires explicit recovery, and rejects checksum drift", async () => {
    const migration: Migration = {
      version: 1,
      name: "recoverable",
      checksum: "a".repeat(64),
      sql: "INSERT INTO review_recovery_target (value) VALUES ('recovered')",
      file: "review-recoverable.sql",
    };
    const migrator = new DatabaseMigrator({
      pool: pool!,
      migrations: [migration],
      historyTable: "review_recovery_history",
      minimumCompatibleVersion: 1,
    });
    await expect(migrator.migrate()).rejects.toMatchObject({
      code: "MIGRATION_APPLY_FAILED",
    });
    await expect(migrator.migrate()).rejects.toMatchObject({
      code: "MIGRATION_RECOVERY_REQUIRED",
    });

    await pool!.query("CREATE TABLE review_recovery_target (value text NOT NULL)");
    expect(await migrator.migrate({ recover: true })).toMatchObject({
      currentVersion: 1,
      compatible: true,
      dirty: [],
    });
    expect((await pool!.query("SELECT value FROM review_recovery_target")).rows).toEqual([
      { value: "recovered" },
    ]);

    const drifted = new DatabaseMigrator({
      pool: pool!,
      migrations: [{ ...migration, checksum: "b".repeat(64) }],
      historyTable: "review_recovery_history",
      minimumCompatibleVersion: 1,
    });
    await expect(drifted.status()).rejects.toBeInstanceOf(DatabaseMigrationError);
    await expect(drifted.status()).rejects.toMatchObject({
      code: "MIGRATION_CHECKSUM_MISMATCH",
    });
  }, 15_000);
});
