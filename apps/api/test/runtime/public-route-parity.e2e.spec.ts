import { IdentityService } from "../../src/modules/identity/service.mjs";
import { createApiApplication } from "../../src/app.js";
import type { ApiRuntime } from "../../src/runtime.js";
import {
  ApiProblemError,
  generatedOperations,
  OnTheRoadClient,
} from "@on-the-road/contracts";
import { afterEach, describe, expect, test } from "vitest";

let app: Awaited<ReturnType<typeof createApiApplication>> | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function createRuntime(): ApiRuntime {
  const identity = new IdentityService({
    environment: "development",
    developmentIdentityEnabled: true,
    appOrigin: "http://127.0.0.1:3000",
    signingKeys: {
      active: {
        id: "route-parity-v1",
        secret: "route-parity-signing-secret-at-least-32-characters",
      },
    },
  });
  return {
    appOrigin: "http://127.0.0.1:3000",
    environment: "development",
    identity,
    trips: {
      deleteTrip: async () => ({ id: "trip-1", version: 2 }),
      restoreTrip: async () => ({ id: "trip-1", version: 3 }),
    },
    tripDates: {
      apply: async () => ({ id: "trip-1", version: 4, days: [] }),
    },
    itinerary: {
      get: async () => ({ id: "item-1", version: 1 }),
      update: async () => ({ id: "item-1", version: 2 }),
      delete: async () => ({ id: "item-1", version: 3 }),
      copy: async () => ({ id: "item-2", version: 1 }),
    },
    itineraryOrder: {
      reorder: async () => ({
        tripDayId: "day-1",
        version: 2,
        orderedIds: ["item-1"],
        eventId: "event-1",
      }),
    },
    locations: {
      selectCandidate: async () => ({ id: "location-1", version: 2 }),
    },
    locationSearch: {
      capabilities: () => ({
        provider: "fixture",
        mapProfile: "fixture",
        search: true,
        reverse: true,
        autocomplete: false,
        fuzzy: true,
      }),
    },
    expenses: {
      create: async () => ({ id: "expense-1" }),
      summary: async () => ({ settledActualTotal: "42.00" }),
      setRate: async () => ({ fromCurrency: "USD", toCurrency: "CNY" }),
    },
    attachments: {
      createSession: async () => ({ attachmentId: "attachment-1" }),
      complete: async () => ({ id: "attachment-1", status: "uploaded" }),
    },
    imports: {
      createUpload: async () => ({ attachmentId: "import-1" }),
      queueInspection: async () => ({ id: "job-1", status: "queued" }),
      getJob: async () => ({ id: "job-1", status: "queued" }),
    },
    referenceData: () => ({
      currencies: [],
      costCategories: [],
      transportModes: [],
      currencyAliases: {},
    }),
    checkReadiness: async () => ({ database: true }),
    close: async () => {},
  } as unknown as ApiRuntime;
}

function fastifyPath(openApiPath: string): string {
  return `/api/v1${openApiPath.replaceAll(/\{([^}]+)\}/gu, ":$1")}`;
}

describe("REVIEW-P1-03 public transport parity", () => {
  test("mounts every non-test OpenAPI operation on the real Nest/Fastify adapter", async () => {
    app = await createApiApplication(createRuntime());
    const server = app.getHttpAdapter().getInstance();
    for (const [operationId, operation] of Object.entries(generatedOperations)) {
      if (operation.contractTestOnly) continue;
      expect(
        server.hasRoute({
          method: operation.method,
          url: fastifyPath(operation.path),
        }),
        `${operationId} ${operation.method} ${operation.path}`,
      ).toBe(true);
    }
  });

  test("uses the generated client against real controllers and Problem Details", async () => {
    const runtime = createRuntime();
    app = await createApiApplication(runtime);
    await app.listen(0, "127.0.0.1");
    const login = await runtime.identity.loginWithDevelopmentIdentity({
      subject: "route-owner",
      origin: runtime.appOrigin,
    });
    const sessionCookie = login.setCookie.split(";", 1)[0];
    const client = new OnTheRoadClient(await app.getUrl(), {
      fetch: (input, init) => fetch(input, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers).entries()),
          cookie: sessionCookie,
        },
      }),
    });

    await expect(client.request("createAttachmentUploadSession", {
      path: { tripId: "trip-1" },
      headers: { "idempotency-key": "attachment-1" },
      body: {
        filename: "arrival.jpg",
        contentType: "image/jpeg",
        contentLength: 1,
        checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      },
    })).resolves.toMatchObject({
      data: { attachmentId: "attachment-1" },
    });
    await expect(client.request("createExpense", {
      path: { tripId: "trip-1" },
      headers: { "idempotency-key": "expense-1" },
      body: { amount: "42.00", currency: "CNY", categoryCode: "DINING" },
    })).resolves.toMatchObject({ data: { id: "expense-1" } });
    await expect(client.request("getJob", {
      path: { jobId: "job-1" },
    })).resolves.toMatchObject({ data: { status: "queued" } });

    const anonymous = new OnTheRoadClient(await app.getUrl());
    await expect(anonymous.request("getJob", {
      path: { jobId: "job-1" },
    })).rejects.toMatchObject({
      problem: {
        status: 401,
        code: "SESSION_REQUIRED",
      },
    } satisfies Partial<ApiProblemError>);
  });
});
