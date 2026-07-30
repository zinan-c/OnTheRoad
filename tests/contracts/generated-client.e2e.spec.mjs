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
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  server = undefined;
});

test("TC-A04-03 generated client round-trips success and 4xx Problem Details", async () => {
  server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/v1/system/capabilities") {
      response.setHeader("etag", "\"capabilities-v1\"");
      response.end(JSON.stringify({
        geocoding: true,
        reverseGeocoding: true,
        directions: false,
        staticMaps: false,
        imports: true,
        exports: false,
      }));
      return;
    }
    response.statusCode = 404;
    response.setHeader("content-type", "application/problem+json");
    response.end(JSON.stringify({
      type: "https://ontheroad.app/problems/not-found",
      title: "Resource not found",
      status: 404,
      code: "NOT_FOUND",
      traceId: "trace-round-trip",
      errors: [],
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const client = new OnTheRoadClient(`http://127.0.0.1:${address.port}`);

  const success = await client.request("getCapabilities");
  assert.equal(success.data.geocoding, true);
  assert.equal(success.etag, "\"capabilities-v1\"");

  await assert.rejects(
    () => client.request("getJob", {
      path: { jobId: "106144e2-4d65-4bd0-a67d-43edbc88ac8d" },
    }),
    (error) => {
      assert.ok(error instanceof ApiProblemError);
      assert.equal(error.problem.status, 404);
      assert.equal(error.problem.traceId, "trace-round-trip");
      return true;
    },
  );
});
