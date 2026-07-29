import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect } from "vitest";

import { PostgresTripRepository } from "../../apps/api/src/modules/trips/postgres-repository.mjs";
import { TripService } from "../../apps/api/src/modules/trips/service.mjs";
import {
  cleanOwner,
  liveTripTest,
  prepareTripDatabase,
  tripDatabaseUrl,
} from "../../apps/api/test/trips/postgres-harness.mjs";

const ownerId = `tc-b02-restart-${randomUUID()}`;

describe("TC-B02-03 restart persistence", () => {
  beforeAll(prepareTripDatabase);
  afterAll(async () => {
    if (tripDatabaseUrl) await cleanOwner(ownerId);
  });

  liveTripTest("survives a new repository/API service instance with audit intact", async () => {
    const firstRepository = new PostgresTripRepository({ databaseUrl: tripDatabaseUrl! });
    const firstService = new TripService(firstRepository);
    const created = await firstService.createTrip(
      ownerId,
      {
        name: "Restart proof",
        startDate: "2027-01-01",
        endDate: "2027-01-03",
        travelers: 3,
        defaultCurrency: "USD",
        budget: "1200.00",
        timezone: "America/Los_Angeles",
        mapProfile: "international_primary",
        destinations: [{ name: "San Francisco", countryCode: "US" }],
      },
      { idempotencyKey: "tc-b02-restart-create" },
    );

    const secondRepository = new PostgresTripRepository({ databaseUrl: tripDatabaseUrl! });
    const restartedService = new TripService(secondRepository);
    const fetched = await restartedService.getTrip(ownerId, created.id);
    const listed = await restartedService.listTrips(ownerId, { limit: 20 });
    const audit = await secondRepository.listAudit(ownerId, created.id);

    expect(fetched).toEqual(created);
    expect(listed.items.map((trip) => trip.id)).toContain(created.id);
    expect(audit).toEqual([
      expect.objectContaining({
        action: "trip.created",
        ownerId,
        tripId: created.id,
        version: 1,
      }),
    ]);
  });
});
