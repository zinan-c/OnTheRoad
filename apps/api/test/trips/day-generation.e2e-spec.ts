import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect } from "vitest";

import { PostgresTripDayRepository } from "../../src/modules/trips/postgres-day-repository.mjs";
import { PostgresTripRepository } from "../../src/modules/trips/postgres-repository.mjs";
import { TripDateChangeService } from "../../src/modules/trips/date-change.mjs";
import { TripService } from "../../src/modules/trips/service.mjs";
import {
  cleanOwner,
  liveTripTest,
  prepareTripDatabase,
  psql,
  tripDatabaseUrl,
} from "./postgres-harness.mjs";

const ownerId = `tc-b03-${randomUUID()}`;
let trips: TripService;
let dates: TripDateChangeService;

beforeAll(async () => {
  await prepareTripDatabase();
  if (!tripDatabaseUrl) return;
  const managedSchema = Boolean(
    await psql("SELECT to_regclass('public.otr_schema_migration')"),
  );
  if (!managedSchema) {
    await psql("\\i packages/database/src/migrations/0006_trip_day.sql");
  }
  trips = new TripService(new PostgresTripRepository({ databaseUrl: tripDatabaseUrl }));
  dates = new TripDateChangeService(
    new PostgresTripDayRepository({ databaseUrl: tripDatabaseUrl }),
  );
});

afterAll(async () => {
  if (!tripDatabaseUrl) return;
  await dropFailureTrigger();
  await cleanOwner(ownerId);
});

liveTripTest("TC-B03-03 create and date apply are atomic and retryable", async () => {
  await installFailureTrigger(3);
  const input = tripInput();
  await expect(trips.createTrip(ownerId, input, {
    idempotencyKey: "tc-b03-atomic-create",
  })).rejects.toMatchObject({
    name: "PostgresRuntimeError",
    code: "DATABASE_QUERY_FAILED",
  });
  expect(await psql(`SELECT count(*) FROM trip WHERE owner_id = '${ownerId}'`)).toBe("0");

  await dropFailureTrigger();
  const created = await trips.createTrip(ownerId, input, {
    idempotencyKey: "tc-b03-atomic-create",
  });
  const initial = await dates.preview(ownerId, created.id, {
    startDate: input.startDate,
    endDate: input.endDate,
  });
  expect(initial.retained.map(({ dayNumber, date }) => ({ dayNumber, date }))).toEqual([
    { dayNumber: 1, date: "2026-10-01" },
    { dayNumber: 2, date: "2026-10-02" },
    { dayNumber: 3, date: "2026-10-03" },
    { dayNumber: 4, date: "2026-10-04" },
    { dayNumber: 5, date: "2026-10-05" },
  ]);

  await installFailureTrigger(6);
  await expect(dates.apply(ownerId, created.id, {
    startDate: "2026-10-01",
    endDate: "2026-10-06",
    expectedVersion: created.version,
  })).rejects.toMatchObject({
    name: "PostgresRuntimeError",
    code: "DATABASE_QUERY_FAILED",
  });
  const unchanged = await dates.preview(ownerId, created.id, {
    startDate: "2026-10-01",
    endDate: "2026-10-05",
  });
  expect(unchanged.retained).toHaveLength(5);

  await dropFailureTrigger();
  const applied = await dates.apply(ownerId, created.id, {
    startDate: "2026-10-01",
    endDate: "2026-10-06",
    expectedVersion: created.version,
  });
  expect(applied).toMatchObject({ totalDays: 6, version: 2 });
  expect(applied.days.map(({ dayNumber }) => dayNumber)).toEqual([1, 2, 3, 4, 5, 6]);
});

function tripInput() {
  return {
    name: "B03 atomic dates",
    startDate: "2026-10-01",
    endDate: "2026-10-05",
    travelers: 2,
    defaultCurrency: "CNY",
    budget: "1000.00",
    timezone: "Asia/Shanghai",
    mapProfile: "cn_primary",
    destinations: [{ name: "上海", countryCode: "CN" }],
  };
}

async function installFailureTrigger(dayNumber: number) {
  await dropFailureTrigger();
  await psql(`
    CREATE FUNCTION tc_b03_fail_day() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.day_number = ${dayNumber} THEN
        RAISE EXCEPTION 'injected trip day failure';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER tc_b03_fail_day
    BEFORE INSERT ON trip_day
    FOR EACH ROW EXECUTE FUNCTION tc_b03_fail_day();
  `);
}

async function dropFailureTrigger() {
  if (!tripDatabaseUrl) return;
  await psql(`
    DROP TRIGGER IF EXISTS tc_b03_fail_day ON trip_day;
    DROP FUNCTION IF EXISTS tc_b03_fail_day();
  `).catch(() => undefined);
}
