import { randomUUID } from "node:crypto";

import { createApiApplication } from "../../dist/app.js";
import { IdentityService } from "../../dist/modules/identity/service.mjs";

const appOrigin = "http://127.0.0.1:3000";
const identity = new IdentityService({
  environment: "development",
  developmentIdentityEnabled: true,
  appOrigin,
  signingKeys: {
    active: {
      id: "browser-e2e-v1",
      secret: "browser-e2e-signing-secret-at-least-32-characters",
    },
  },
});
const trips = new Map();

function daysBetween(startDate, endDate) {
  return Math.floor(
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`))
      / 86_400_000,
  ) + 1;
}

const runtime = {
  appOrigin,
  environment: "development",
  identity,
  trips: {
    async createTrip(ownerId, input) {
      const now = new Date().toISOString();
      const id = randomUUID();
      const trip = {
        ...input,
        id,
        ownerId,
        totalDays: daysBetween(input.startDate, input.endDate),
        status: "draft",
        version: 1,
        budget: null,
        description: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
        destinations: (input.destinations ?? []).map((destination, sortOrder) => ({
          id: randomUUID(),
          countryCode: null,
          city: null,
          region: null,
          ...destination,
          sortOrder,
          createdAt: now,
          updatedAt: now,
        })),
      };
      trips.set(id, trip);
      return trip;
    },
    async getTrip(ownerId, tripId) {
      const trip = trips.get(tripId);
      if (!trip || trip.ownerId !== ownerId) {
        const error = new Error("Trip not found");
        error.status = 404;
        error.code = "TRIP_NOT_FOUND";
        throw error;
      }
      return trip;
    },
    async listTrips(ownerId) {
      return {
        items: [...trips.values()].filter((trip) => trip.ownerId === ownerId),
        nextCursor: null,
      };
    },
  },
  itinerary: {},
  locations: {},
  locationSearch: {
    capabilities: () => ({
      provider: "browser-fixture",
      mapProfile: "fixture",
      search: true,
      reverse: true,
      autocomplete: false,
      fuzzy: true,
    }),
  },
  expenses: {},
  attachments: {},
  referenceData: () => ({
    currencies: [],
    costCategories: [],
    transportModes: [],
    currencyAliases: {},
  }),
  checkReadiness: async () => ({
    database: true,
    schema: true,
    redis: true,
    storage: true,
    clamav: true,
    mapProvider: true,
  }),
  close: async () => {},
};

const application = await createApiApplication(runtime);
await application.listen(3001, "127.0.0.1");

async function close() {
  await application.close();
  process.exit(0);
}

process.once("SIGINT", close);
process.once("SIGTERM", close);
