import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { IdentityService } from "../../../apps/api/src/modules/identity/index.mjs";
import { PostgresTripDayRepository } from "../../../apps/api/src/modules/trips/postgres-day-repository.mjs";
import { PostgresTripRepository } from "../../../apps/api/src/modules/trips/postgres-repository.mjs";
import { TripService } from "../../../apps/api/src/modules/trips/service.mjs";
import {
  databaseUrl,
  prepareTripDatabase,
  psql,
  sqlText,
} from "./native-harness.mjs";

const nativeTest = databaseUrl ? test : test.skip;
const appOrigin = "https://app.example.test";
let ownerId = "";
let otherOwnerId = "";

function login(subject: string) {
  const identity = new IdentityService({
    environment: "development",
    developmentIdentityEnabled: true,
    appOrigin,
    signingKeys: {
      active: { id: "m1-gate", secret: "m1-gate-signing-secret-at-least-32-bytes" },
    },
  });
  return identity.loginWithDevelopmentIdentity({ subject, origin: appOrigin }).principal;
}

describe("TC-M1-INT-01 trip platform integration", () => {
  beforeAll(async () => {
    await prepareTripDatabase();
    ownerId = login(`m1-owner-${randomUUID()}`).id;
    otherOwnerId = login(`m1-other-${randomUUID()}`).id;
  });

  afterAll(async () => {
    if (!databaseUrl || !ownerId) return;
    await psql(`DELETE FROM trip WHERE owner_id = ${sqlText(ownerId)}`);
  });

  nativeTest(
    "login, five-day creation, owner isolation, and restart persistence stay atomic",
    async () => {
      const firstRepository = new PostgresTripRepository({ databaseUrl: databaseUrl! });
      const firstService = new TripService(firstRepository);
      const created = await firstService.createTrip(
        ownerId,
        {
          name: "M1 platform gate",
          startDate: "2027-03-01",
          endDate: "2027-03-05",
          travelers: 2,
          defaultCurrency: "CNY",
          budget: "5000.00",
          timezone: "Asia/Shanghai",
          mapProfile: "cn_primary",
          destinations: [{ name: "杭州", countryCode: "CN" }],
        },
        { idempotencyKey: `m1-create-${randomUUID()}` },
      );

      const dayRepository = new PostgresTripDayRepository({ databaseUrl: databaseUrl! });
      const dateContext = await dayRepository.loadDateContext(ownerId, created.id);
      expect(dateContext.days).toEqual([
        expect.objectContaining({ dayNumber: 1, date: "2027-03-01" }),
        expect.objectContaining({ dayNumber: 2, date: "2027-03-02" }),
        expect.objectContaining({ dayNumber: 3, date: "2027-03-03" }),
        expect.objectContaining({ dayNumber: 4, date: "2027-03-04" }),
        expect.objectContaining({ dayNumber: 5, date: "2027-03-05" }),
      ]);
      await expect(firstService.getTrip(otherOwnerId, created.id)).rejects.toMatchObject({
        status: 404,
      });

      const restartedRepository = new PostgresTripRepository({ databaseUrl: databaseUrl! });
      const restartedService = new TripService(restartedRepository);
      expect(await restartedService.getTrip(ownerId, created.id)).toEqual(created);
      expect(await restartedRepository.listAudit(ownerId, created.id)).toEqual([
        expect.objectContaining({
          action: "trip.created",
          ownerId,
          tripId: created.id,
          version: 1,
        }),
      ]);
      expect(await psql(
        `SELECT count(*) FROM trip_day WHERE trip_id = (${sqlText(created.id)})::uuid`,
      )).toBe("5");
    },
  );
});
