import { IdentityService } from "../../src/modules/identity/service.mjs";
import { createApiApplication } from "../../src/app.js";
import type { ApiRuntime } from "../../src/runtime.js";
import { readFile } from "node:fs/promises";
import { InMemoryTelemetrySink } from "@on-the-road/observability";
import {
  ApiProblemError,
  generatedOperations,
  OnTheRoadClient,
} from "@on-the-road/contracts";
import { afterEach, describe, expect, test } from "vitest";
import { createApiTelemetry } from "../../src/telemetry.js";

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
      list: async () => [],
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
    routes: {
      list: async () => [],
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

  test("documents every public Nest/Fastify controller route in OpenAPI", async () => {
    const source = await readFile(new URL("../../src/app.ts", import.meta.url), "utf8");
    const controllerRoutes = [...source.matchAll(
      /@(Get|Post|Put|Patch|Delete)\("([^"]+)"\)/gu,
    )]
      .map((match) => ({
        method: String(match[1]).toUpperCase(),
        path: `/${String(match[2]).replaceAll(/:([^/]+)/gu, "{$1}")}`,
      }))
      .filter(({ path }) => !path.startsWith("/health/"));
    const contractedRoutes = Object.values(generatedOperations)
      .filter(({ contractTestOnly }) => !contractTestOnly)
      .map(({ method, path }) => ({ method, path }));

    expect(controllerRoutes.sort(routeOrder)).toEqual(contractedRoutes.sort(routeOrder));
  });

  test("uses the generated client against real controllers and Problem Details", async () => {
    const runtime = createRuntime();
    app = await createApiApplication(runtime);
    const server = app.getHttpAdapter().getInstance();
    const inProcessFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      const response = await server.inject({
        method: request.method,
        url: new URL(request.url).pathname + new URL(request.url).search,
        headers: Object.fromEntries(request.headers.entries()),
        ...(request.body === null ? {} : { payload: await request.text() }),
      });
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) headers.append(name, item);
        } else if (value !== undefined) {
          headers.set(name, String(value));
        }
      }
      return new Response(response.body, { status: response.statusCode, headers });
    };
    const login = await runtime.identity.loginWithDevelopmentIdentity({
      subject: "route-owner",
      origin: runtime.appOrigin,
    });
    const sessionCookie = login.setCookie.split(";", 1)[0];
    const client = new OnTheRoadClient("http://127.0.0.1", {
      fetch: (input, init) => inProcessFetch(input, {
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

    const anonymous = new OnTheRoadClient("http://127.0.0.1", {
      fetch: inProcessFetch,
    });
    await expect(anonymous.request("getJob", {
      path: { jobId: "job-1" },
    })).rejects.toMatchObject({
      problem: {
        status: 401,
        code: "SESSION_REQUIRED",
      },
    } satisfies Partial<ApiProblemError>);
  });

  test("emits bounded route-template metrics without entity IDs or credentials", async () => {
    const sink = new InMemoryTelemetrySink();
    const runtime = createRuntime();
    app = await createApiApplication(runtime, {
      telemetry: createApiTelemetry([sink]),
    });
    const server = app.getHttpAdapter().getInstance();
    const login = await runtime.identity.loginWithDevelopmentIdentity({
      subject: "telemetry-owner",
      origin: runtime.appOrigin,
    });
    const sessionCookie = login.setCookie.split(";", 1)[0];

    const response = await server.inject({
      method: "GET",
      url: "/api/v1/trips/11111111-1111-4111-8111-111111111111/routes",
      headers: {
        cookie: sessionCookie,
        "x-request-id": "m3-telemetry-request",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBe("m3-telemetry-request");
    const serialized = JSON.stringify(sink.entries);
    expect(serialized).toContain("/api/v1/trips/:tripId/routes");
    expect(serialized).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(serialized).not.toContain(sessionCookie);
    expect(sink.entries.filter(({ kind }) => kind === "metric")).toHaveLength(2);
    expect(sink.entries.filter(({ kind }) => kind === "span")).toHaveLength(1);
  });
});

function routeOrder(
  left: { method: string; path: string },
  right: { method: string; path: string },
) {
  return `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`);
}
