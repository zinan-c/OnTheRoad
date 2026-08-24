import {
  DatabaseMigrationError,
  DatabaseMigrator,
  createDatabasePool,
  discoverMigrations,
} from "./migration/index.js";
import { seedSystemReferenceData } from "./seed.js";

const [command, ...flags] = process.argv.slice(2);
const json = flags.includes("--json");
const pool = createDatabasePool(process.env.DATABASE_URL ?? "");

try {
  const migrations = await discoverMigrations();
  const migrator = new DatabaseMigrator({ pool, migrations });
  switch (command) {
    case "migrate": {
      const status = await migrator.migrate({ recover: flags.includes("--recover") });
      output(status);
      break;
    }
    case "status": {
      const status = await migrator.status();
      output(status);
      if (flags.includes("--check") && (!status.compatible || status.pending.length > 0)) {
        process.exitCode = 1;
      }
      break;
    }
    case "seed": {
      const status = await migrator.status();
      if (!status.compatible || status.pending.length > 0) {
        throw new DatabaseMigrationError(
          "DATABASE_SCHEMA_NOT_READY",
          "Apply all compatible migrations before seeding reference data.",
        );
      }
      output(await seedSystemReferenceData(pool, process.env));
      break;
    }
    default:
      throw new DatabaseMigrationError(
        "DATABASE_COMMAND_INVALID",
        "Expected one of: migrate [--recover], status [--check], seed.",
      );
  }
} catch (error) {
  const safeError = error instanceof DatabaseMigrationError
    ? { code: error.code, message: error.message, details: error.details }
    : { code: "DATABASE_COMMAND_FAILED", message: "Database command failed." };
  console.error(json ? JSON.stringify(safeError) : `${safeError.code}: ${safeError.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}

function output(value: unknown): void {
  console.log(json ? JSON.stringify(value) : JSON.stringify(value, null, 2));
}
