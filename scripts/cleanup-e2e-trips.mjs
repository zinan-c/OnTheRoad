import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import pg from "../packages/database/node_modules/pg/esm/index.mjs";

const { Pool } = pg;

export const REQUIRED_DELETE_COUNT = 484;
export const EXECUTE_CONFIRMATION = "DELETE_484_STRONG_E2E_TRIPS";
export const BUSINESS_TRIP = Object.freeze({
  id: "d9221038-a450-4f34-a33d-e78ed987be0f",
  name: "菲律宾海岛潜水之旅（2026-09）",
});
export const STRONG_RULE_SQL = [
  "t.name ~* '^E2E-[0-9]{3}'",
  "t.name ~* '^(C|D|E)[0-9]{2} '",
  "t.name ~* 'Playwright|真实|验证|layout inspect'",
].join(" OR ");
export const CANDIDATE_RULE_SQL = `(${STRONG_RULE_SQL}) OR t.name = 'Shanghai and Zhoushan'`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const DATABASE_NAME_PATTERN = /^[a-zA-Z0-9_]+$/u;

export function idSetSha256(ids) {
  return createHash("sha256").update([...ids].sort().join("\n") + "\n").digest("hex");
}

export function parseCleanupOptions(argv) {
  const values = new Map();
  let execute = false;
  for (const argument of argv) {
    if (argument === "--execute") {
      execute = true;
      continue;
    }
    if (argument === "--dry-run") continue;
    const match = /^--([a-z0-9-]+)=(.+)$/u.exec(argument);
    if (!match) throw new Error(`Unknown cleanup argument: ${argument}`);
    if (values.has(match[1])) throw new Error(`Duplicate cleanup argument: --${match[1]}`);
    values.set(match[1], match[2]);
  }

  const required = [
    "id-file",
    "expected-count",
    "expected-id-sha256",
    "expected-database",
    "expected-database-oid",
  ];
  for (const name of required) {
    if (!values.get(name)) throw new Error(`--${name} is required`);
  }
  if (Number(values.get("expected-count")) !== REQUIRED_DELETE_COUNT) {
    throw new Error(`--expected-count must equal ${REQUIRED_DELETE_COUNT}`);
  }
  if (!SHA256_PATTERN.test(values.get("expected-id-sha256"))) {
    throw new Error("--expected-id-sha256 must be a lowercase SHA-256 value");
  }
  if (!DATABASE_NAME_PATTERN.test(values.get("expected-database"))) {
    throw new Error("--expected-database is invalid");
  }
  if (!/^[1-9][0-9]*$/u.test(values.get("expected-database-oid"))) {
    throw new Error("--expected-database-oid must be a positive integer");
  }
  if (execute && values.get("confirm") !== EXECUTE_CONFIRMATION) {
    throw new Error(`--execute requires --confirm=${EXECUTE_CONFIRMATION}`);
  }
  if (!execute && values.has("confirm")) {
    throw new Error("--confirm is accepted only together with --execute");
  }

  return Object.freeze({
    execute,
    idFile: values.get("id-file"),
    expectedCount: REQUIRED_DELETE_COUNT,
    expectedIdSha256: values.get("expected-id-sha256"),
    expectedDatabase: values.get("expected-database"),
    expectedDatabaseOid: values.get("expected-database-oid"),
  });
}

export function validateManifest(manifest, options) {
  if (!manifest || typeof manifest !== "object") throw new Error("ID manifest must be an object");
  if (!Array.isArray(manifest.strongIds)) throw new Error("ID manifest strongIds must be an array");
  const ids = [...manifest.strongIds];
  if (ids.length !== options.expectedCount) {
    throw new Error(`ID manifest count mismatch: ${ids.length}`);
  }
  if (ids.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))) {
    throw new Error("ID manifest contains an invalid UUID");
  }
  if (new Set(ids).size !== ids.length) throw new Error("ID manifest contains duplicate UUIDs");
  if (ids.some((id, index) => index > 0 && ids[index - 1].localeCompare(id) >= 0)) {
    throw new Error("ID manifest must be sorted by UUID");
  }
  const hash = idSetSha256(ids);
  if (hash !== options.expectedIdSha256 || manifest.strongIdSha256 !== hash) {
    throw new Error("ID manifest SHA-256 mismatch");
  }
  if (manifest.database?.name !== options.expectedDatabase
    || String(manifest.database?.oid) !== options.expectedDatabaseOid) {
    throw new Error("ID manifest database identity mismatch");
  }
  if (manifest.counts?.totalTrips !== 487
    || manifest.counts?.candidates !== 486
    || manifest.counts?.strong !== REQUIRED_DELETE_COUNT
    || manifest.counts?.weakPreserved !== 2
    || manifest.counts?.businessPreserved !== 1) {
    throw new Error("ID manifest preflight counts do not match the authorized cleanup");
  }
  const preserved = Array.isArray(manifest.preserved) ? manifest.preserved : [];
  const shanghai = preserved.filter((row) => row?.name === "Shanghai and Zhoushan");
  const business = preserved.filter((row) => row?.id === BUSINESS_TRIP.id && row?.name === BUSINESS_TRIP.name);
  if (preserved.length !== 3 || shanghai.length !== 2 || business.length !== 1) {
    throw new Error("ID manifest must contain the exact three preserved Trips");
  }
  const idSet = new Set(ids);
  if (preserved.some((row) => !UUID_PATTERN.test(row?.id ?? "") || idSet.has(row.id))) {
    throw new Error("A preserved Trip is invalid or overlaps the deletion set");
  }
  return Object.freeze({ ids, hash, preserved: preserved.map((row) => ({ id: row.id, name: row.name })) });
}

export async function runCleanup(options, environment = process.env) {
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const manifestText = await readFile(options.idFile, "utf8");
  if (Buffer.byteLength(manifestText) > 256_000) throw new Error("ID manifest is unexpectedly large");
  const manifest = JSON.parse(manifestText);
  const validated = validateManifest(manifest, options);
  const parsedUrl = new URL(databaseUrl);
  const urlDatabase = decodeURIComponent(parsedUrl.pathname.replace(/^\//u, ""));
  const urlPort = parsedUrl.port || "5432";
  if (urlDatabase !== options.expectedDatabase
    || parsedUrl.hostname !== manifest.database.host
    || urlPort !== String(manifest.database.port)) {
    throw new Error("DATABASE_URL does not match the preflight database identity");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    statement_timeout: 300_000,
    application_name: options.execute
      ? "on-the-road-e2e-trip-cleanup-execute"
      : "on-the-road-e2e-trip-cleanup-dry-run",
  });
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionOpen = true;
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL statement_timeout = '5min'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('on-the-road-e2e-trip-cleanup-v1'))");

    const identity = (await client.query(
      "SELECT current_database() AS database, "
      + "(SELECT oid::text FROM pg_database WHERE datname = current_database()) AS database_oid",
    )).rows[0];
    if (identity.database !== options.expectedDatabase
      || identity.database_oid !== options.expectedDatabaseOid) {
      throw new Error("Connected database identity changed after preflight");
    }

    const strongRows = (await client.query(
      `SELECT t.id::text, t.name FROM trip t WHERE ${STRONG_RULE_SQL} ORDER BY t.id FOR UPDATE`,
    )).rows;
    const currentIds = strongRows.map((row) => row.id);
    if (currentIds.length !== options.expectedCount
      || idSetSha256(currentIds) !== validated.hash
      || currentIds.some((id, index) => id !== validated.ids[index])) {
      throw new Error("Strong-rule Trip set changed after preflight");
    }
    const candidateCount = Number((await client.query(
      `SELECT count(*)::int AS count FROM trip t WHERE ${CANDIDATE_RULE_SQL}`,
    )).rows[0].count);
    if (candidateCount !== 486) throw new Error(`Candidate count changed: ${candidateCount}`);
    const totalTripCount = Number((await client.query(
      "SELECT count(*)::int AS count FROM trip",
    )).rows[0].count);
    if (totalTripCount !== 487) throw new Error(`Total Trip count changed: ${totalTripCount}`);

    const preservedRows = (await client.query(
      "SELECT id::text, name FROM trip WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [validated.preserved.map((row) => row.id)],
    )).rows;
    if (preservedRows.length !== 3
      || idSetSha256(preservedRows.map((row) => row.id))
        !== idSetSha256(validated.preserved.map((row) => row.id))) {
      throw new Error("A preserved Trip is missing or changed");
    }
    const weakRows = preservedRows.filter((row) => row.name === "Shanghai and Zhoushan");
    const businessRows = preservedRows.filter((row) => row.id === BUSINESS_TRIP.id && row.name === BUSINESS_TRIP.name);
    if (weakRows.length !== 2 || businessRows.length !== 1) {
      throw new Error("Preserved Trip names changed after preflight");
    }

    const tableNames = (await client.query(
      "SELECT DISTINCT c.table_name FROM information_schema.columns c "
      + "JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name "
      + "WHERE c.table_schema = 'public' AND c.column_name = 'trip_id' "
      + "AND t.table_type = 'BASE TABLE' AND c.table_name <> 'trip' ORDER BY c.table_name",
    )).rows.map((row) => row.table_name);
    if (tableNames.length < 20 || tableNames.some((name) => !/^[a-z_][a-z0-9_]*$/u.test(name))) {
      throw new Error("Unexpected trip-associated table inventory");
    }
    const beforeCounts = await countDirectRows(client, tableNames, validated.ids);
    const indirectBefore = await countIndirectRows(client, validated.ids);
    const orphanBefore = await countGlobalOrphans(client, tableNames);
    const plan = {
      mode: options.execute ? "execute" : "dry-run",
      database: { name: identity.database, oid: identity.database_oid },
      strongTrips: currentIds.length,
      strongIdSha256: validated.hash,
      candidates: candidateCount,
      totalTrips: totalTripCount,
      preserved: preservedRows,
      associatedRows: { ...beforeCounts, ...indirectBefore },
      orphanRows: orphanBefore,
    };

    if (!options.execute) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return Object.freeze({ ...plan, committed: false });
    }

    const manualDeletes = {};
    manualDeletes.jobRun = (await client.query(
      "DELETE FROM job_run WHERE event_id IN ("
      + "SELECT o.event_id FROM job_outbox o JOIN trip_day d ON d.id::text = o.aggregate_id "
      + "WHERE d.trip_id = ANY($1::uuid[]))",
      [validated.ids],
    )).rowCount;
    manualDeletes.jobInbox = (await client.query(
      "DELETE FROM job_inbox WHERE event_id IN ("
      + "SELECT o.event_id FROM job_outbox o JOIN trip_day d ON d.id::text = o.aggregate_id "
      + "WHERE d.trip_id = ANY($1::uuid[]))",
      [validated.ids],
    )).rowCount;
    manualDeletes.jobOutbox = (await client.query(
      "DELETE FROM job_outbox o USING trip_day d "
      + "WHERE d.id::text = o.aggregate_id AND d.trip_id = ANY($1::uuid[])",
      [validated.ids],
    )).rowCount;
    manualDeletes.importInspectJob = (await client.query(
      "DELETE FROM import_inspect_job j WHERE j.trip_id = ANY($1::uuid[]) "
      + "OR j.attachment_id IN (SELECT a.id FROM attachment a WHERE a.trip_id = ANY($1::uuid[]))",
      [validated.ids],
    )).rowCount;
    manualDeletes.importRow = (await client.query(
      "DELETE FROM import_row r USING import_job j "
      + "WHERE r.import_job_id = j.id AND j.trip_id = ANY($1::uuid[])",
      [validated.ids],
    )).rowCount;
    manualDeletes.exportJobAsset = (await client.query(
      "DELETE FROM export_job_asset a USING export_job j "
      + "WHERE a.export_job_id = j.id AND j.trip_id = ANY($1::uuid[])",
      [validated.ids],
    )).rowCount;
    manualDeletes.importJob = (await client.query(
      "DELETE FROM import_job WHERE trip_id = ANY($1::uuid[])",
      [validated.ids],
    )).rowCount;

    const expectedManualDeletes = {
      jobRun: indirectBefore["indirect:job_run"],
      jobInbox: indirectBefore["indirect:job_inbox"],
      jobOutbox: indirectBefore["indirect:job_outbox"],
      importInspectJob: indirectBefore["indirect:import_inspect_job_all"],
      importRow: indirectBefore["indirect:import_row"],
      exportJobAsset: indirectBefore["indirect:export_job_asset"],
      importJob: beforeCounts.import_job,
    };
    for (const [name, expected] of Object.entries(expectedManualDeletes)) {
      if (manualDeletes[name] !== expected) {
        throw new Error(`Manual associated delete mismatch for ${name}: ${manualDeletes[name]} != ${expected}`);
      }
    }

    const nonCascadeTables = (await client.query(
      "SELECT c.table_name FROM information_schema.columns c "
      + "JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name "
      + "WHERE c.table_schema = 'public' AND c.column_name = 'trip_id' "
      + "AND t.table_type = 'BASE TABLE' AND c.table_name <> 'trip' "
      + "AND NOT EXISTS (SELECT 1 FROM pg_constraint fk "
      + "WHERE fk.contype = 'f' AND fk.conrelid = ('public.' || quote_ident(c.table_name))::regclass "
      + "AND fk.confrelid = 'public.trip'::regclass AND fk.confdeltype = 'c') "
      + "ORDER BY c.table_name",
    )).rows.map((row) => row.table_name);
    for (const tableName of nonCascadeTables) {
      if (!/^[a-z_][a-z0-9_]*$/u.test(tableName)) throw new Error("Unsafe associated table name");
      manualDeletes[tableName] = (await client.query(
        `DELETE FROM "${tableName}" WHERE trip_id = ANY($1::uuid[])`,
        [validated.ids],
      )).rowCount;
    }

    const deleted = await client.query(
      "DELETE FROM trip WHERE id = ANY($1::uuid[]) RETURNING id::text",
      [validated.ids],
    );
    const deletedIds = deleted.rows.map((row) => row.id).sort();
    if (deleted.rowCount !== options.expectedCount
      || idSetSha256(deletedIds) !== validated.hash) {
      throw new Error(`Deleted Trip count or ID set mismatch: ${deleted.rowCount}`);
    }
    const afterCounts = await countDirectRows(client, tableNames, validated.ids);
    const leftovers = Object.entries(afterCounts).filter(([, count]) => count !== 0);
    if (leftovers.length > 0) throw new Error(`Associated rows remain: ${JSON.stringify(leftovers)}`);
    const remainingTargets = Number((await client.query(
      "SELECT count(*)::int AS count FROM trip WHERE id = ANY($1::uuid[])",
      [validated.ids],
    )).rows[0].count);
    const preservedAfter = Number((await client.query(
      "SELECT count(*)::int AS count FROM trip WHERE id = ANY($1::uuid[])",
      [validated.preserved.map((row) => row.id)],
    )).rows[0].count);
    const remainingTripCount = Number((await client.query(
      "SELECT count(*)::int AS count FROM trip",
    )).rows[0].count);
    if (remainingTargets !== 0 || preservedAfter !== 3 || remainingTripCount !== 3) {
      throw new Error("Post-delete Trip assertions failed");
    }

    await client.query("COMMIT");
    transactionOpen = false;
    return Object.freeze({
      ...plan,
      committed: true,
      deletedTrips: deleted.rowCount,
      manualDeletes,
      remainingTargets,
      preservedAfter,
      remainingTripCount,
      orphanBaseline: orphanBefore,
    });
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function countDirectRows(client, tableNames, ids) {
  const counts = {};
  for (const tableName of tableNames) {
    const result = await client.query(
      `SELECT count(*)::int AS count FROM "${tableName}" WHERE trip_id = ANY($1::uuid[])`,
      [ids],
    );
    counts[tableName] = Number(result.rows[0].count);
  }
  return counts;
}

async function countIndirectRows(client, ids) {
  const queries = {
    import_row: "SELECT count(*)::int AS count FROM import_row r JOIN import_job j ON j.id = r.import_job_id WHERE j.trip_id = ANY($1::uuid[])",
    export_job_asset: "SELECT count(*)::int AS count FROM export_job_asset a JOIN export_job j ON j.id = a.export_job_id WHERE j.trip_id = ANY($1::uuid[])",
    import_inspect_job_all: "SELECT count(*)::int AS count FROM import_inspect_job j WHERE j.trip_id = ANY($1::uuid[]) OR j.attachment_id IN (SELECT a.id FROM attachment a WHERE a.trip_id = ANY($1::uuid[]))",
    job_outbox: "SELECT count(*)::int AS count FROM job_outbox o JOIN trip_day d ON d.id::text = o.aggregate_id WHERE d.trip_id = ANY($1::uuid[])",
    job_inbox: "SELECT count(*)::int AS count FROM job_inbox i JOIN job_outbox o ON o.event_id = i.event_id JOIN trip_day d ON d.id::text = o.aggregate_id WHERE d.trip_id = ANY($1::uuid[])",
    job_run: "SELECT count(*)::int AS count FROM job_run r JOIN job_outbox o ON o.event_id = r.event_id JOIN trip_day d ON d.id::text = o.aggregate_id WHERE d.trip_id = ANY($1::uuid[])",
  };
  const counts = {};
  for (const [name, query] of Object.entries(queries)) {
    counts[`indirect:${name}`] = Number((await client.query(query, [ids])).rows[0].count);
  }
  return counts;
}

async function countGlobalOrphans(client, tableNames) {
  const counts = {};
  for (const tableName of tableNames) {
    const result = await client.query(
      `SELECT count(*)::int AS count FROM "${tableName}" child `
      + "LEFT JOIN trip parent ON parent.id = child.trip_id "
      + "WHERE child.trip_id IS NOT NULL AND parent.id IS NULL",
    );
    counts[tableName] = Number(result.rows[0].count);
  }
  counts["indirect:import_row"] = Number((await client.query(
    "SELECT count(*)::int AS count FROM import_row child "
    + "LEFT JOIN import_job parent ON parent.id = child.import_job_id WHERE parent.id IS NULL",
  )).rows[0].count);
  counts["indirect:export_job_asset"] = Number((await client.query(
    "SELECT count(*)::int AS count FROM export_job_asset child "
    + "LEFT JOIN export_job parent ON parent.id = child.export_job_id WHERE parent.id IS NULL",
  )).rows[0].count);
  return counts;
}

async function main() {
  const options = parseCleanupOptions(process.argv.slice(2));
  const result = await runCleanup(options);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
