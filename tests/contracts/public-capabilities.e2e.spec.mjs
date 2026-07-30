import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, test } from "vitest";
import {
  ApiProblemError,
  OnTheRoadClient,
} from "../../packages/contracts/src/generated/index.mjs";

let server;

afterEach(async () => {
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
  server = undefined;
});

const tripId = "106144e2-4d65-4bd0-a67d-43edbc88ac8d";
const jobId = "206144e2-4d65-4bd0-a67d-43edbc88ac8d";

const cases = [
  {
    module: "identity",
    operationId: "createDevelopmentSession",
    status: 201,
    input: { body: { subject: "contract-owner" } },
  },
  {
    module: "trip-date-change",
    operationId: "changeTripDates",
    status: 200,
    input: {
      path: { tripId },
      headers: { "if-match": "3", "idempotency-key": "date-change-1" },
      body: {
        startDate: "2026-08-01",
        endDate: "2026-08-05",
        removedDayPolicy: "reject_non_empty",
      },
    },
  },
  {
    module: "locations",
    operationId: "searchLocations",
    status: 200,
    input: { path: { tripId }, query: { q: "上海迪士尼" } },
  },
  {
    module: "attachments",
    operationId: "createAttachmentUploadSession",
    status: 201,
    input: {
      path: { tripId },
      headers: { "idempotency-key": "attachment-1" },
      body: {
        filename: "arrival.jpg",
        contentType: "image/jpeg",
        contentLength: 1024,
        checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      },
    },
  },
  {
    module: "expenses",
    operationId: "createExpense",
    status: 201,
    input: {
      path: { tripId },
      headers: { "idempotency-key": "expense-1" },
      body: { amount: "42.00", currency: "CNY", categoryCode: "DINING" },
    },
  },
  {
    module: "imports",
    operationId: "createImportUpload",
    status: 201,
    input: {
      path: { tripId },
      headers: { "idempotency-key": "import-1" },
      body: {
        filename: "trip.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        contentLength: 2048,
        checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      },
    },
  },
  {
    module: "jobs",
    operationId: "getJob",
    status: 200,
    input: { path: { jobId } },
  },
  {
    module: "capabilities",
    operationId: "getCapabilities",
    status: 200,
    input: {},
  },
];

test.each(cases)(
  "P1-03 generated client exercises $module success and Problem Details over HTTP",
  async ({ module, operationId, status, input }) => {
    server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.headers["x-force-problem"] === "true") {
        response.statusCode = 409;
        response.setHeader("content-type", "application/problem+json");
        response.end(JSON.stringify({
          type: `https://ontheroad.app/problems/${module}`,
          title: `${module} contract failure`,
          status: 409,
          code: "CONTRACT_FAILURE",
          traceId: `trace-${module}`,
          errors: [],
        }));
        return;
      }
      response.statusCode = status;
      response.end(JSON.stringify({
        operationId,
        method: request.method,
        url: request.url,
      }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const client = new OnTheRoadClient(`http://127.0.0.1:${address.port}`);

    const success = await client.request(operationId, input);
    assert.equal(success.data.operationId, operationId);

    await assert.rejects(
      () => client.request(operationId, {
        ...input,
        headers: {
          ...input.headers,
          "x-force-problem": "true",
        },
      }),
      (error) => {
        assert.ok(error instanceof ApiProblemError);
        assert.equal(error.problem.status, 409);
        assert.equal(error.problem.traceId, `trace-${module}`);
        return true;
      },
    );
  },
);
