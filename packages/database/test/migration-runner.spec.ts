import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { describe, expect, test } from "vitest";

import {
  discoverMigrations,
  minimumCompatibleSchemaVersion,
} from "../src/migration/index.js";

describe("REVIEW-P1-02 migration manifest", () => {
  test("discovers one ordered migration per version and expands psql includes", async () => {
    const migrations = await discoverMigrations();
    expect(migrations.filter(({ version }) => version <= 28).map(({ version }) => version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
      21, 22, 23, 24, 25, 26, 27, 28,
    ]);
    expect(migrations.at(-1)?.version).toBeGreaterThanOrEqual(minimumCompatibleSchemaVersion);
    for (const migration of migrations) {
      expect(migration.checksum).toMatch(/^[0-9a-f]{64}$/u);
      expect(migration.sql).not.toMatch(/^\\ir\s/gmu);
      expect(migration.sql.trim().length).toBeGreaterThan(20);
    }
    expect(Object.fromEntries(
      migrations
        .filter(({ version }) => [3, 5, 27, 28].includes(version))
        .map(({ version, checksum }) => [version, checksum]),
    )).toEqual({
      3: "906f3f38d3c955e2cb8ab4b66f0e98be2ef3bf10a58bd443430765793d65668c",
      5: "a735beb1deda2f090615742fbd0746bcfbbcdf1b1a24c93223050b4918b96c90",
      27: "07ad2a6713a0d57843718644cbeb2668067dc8056c64059ef9d1255298e55753",
      28: "0ac46fdfa215ac94fff726be5f05d73f4add31d8826d74c9062837198b10c462",
    });
  });

  test("only grandfathered migrations may include mutable schema files", async () => {
    const migrations = await discoverMigrations();
    const grandfatheredMutableIncludes = new Set([
      "0001_jobs.sql:../schema/jobs.sql",
      "0002_reference_data.sql:../schema/reference-data.sql",
      "0004_attachment.sql:../schema/attachment.sql",
      "0006_trip_day.sql:../schema/trip-day.sql",
      "0007_itinerary.sql:../schema/itinerary.sql",
      "0007_itinerary.sql:../schema/accommodation.sql",
      "0007_itinerary.sql:../schema/dining.sql",
      "0008_transport_mode.sql:../schema/transport-mode.sql",
      "0009_attachment_media.sql:../schema/attachment.sql",
      "0011_expense.sql:../schema/exchange-rate.sql",
      "0011_expense.sql:../schema/expense.sql",
      "0012_location_coordinate_audit.sql:../schema/location-coordinate-audit.sql",
      "0013_import_inspect.sql:../schema/import-inspect.sql",
      "0014_route_segment.sql:../schema/route-segment.sql",
      "0015_import_staging.sql:../schema/import-staging.sql",
      "0022_location_attribution.sql:../schema/location.sql",
      "0024_m4_wave0_foundations.sql:../schema/m4-wave0.sql",
      "0025_m4_wave1.sql:../schema/m4-wave1.sql",
    ]);
    const mutableIncludes: string[] = [];

    for (const migration of migrations) {
      const fileName = basename(migration.file);
      const source = await readFile(migration.file, "utf8");
      for (const match of source.matchAll(/^\\ir\s+(.+)$/gmu)) {
        const includePath = match[1]?.trim();
        if (!includePath || includePath.startsWith("./snapshots/")) continue;
        mutableIncludes.push(`${fileName}:${includePath}`);
      }
    }

    expect(
      mutableIncludes.filter((entry) => !grandfatheredMutableIncludes.has(entry)),
    ).toEqual([]);
    expect(
      migrations
        .filter(({ version }) => version > 28)
        .flatMap(({ file }) => mutableIncludes.filter((entry) => entry.startsWith(`${basename(file)}:`))),
    ).toEqual([]);
  });
});
