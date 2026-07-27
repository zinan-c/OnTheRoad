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
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  server = undefined;
});

test("TC-A04-03 generated client round-trips success and 4xx Problem Details", async () => {
  server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/v1/example") {
      response.setHeader("etag", "\"example-v1\"");
      response.end(JSON.stringify({ id: "106144e2-4d65-4bd0-a67d-43edbc88ac8d", date: "2026-07-27" }));
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

  const success = await client.getExample();
  assert.equal(success.data.date, "2026-07-27");
  assert.equal(success.etag, "\"example-v1\"");

  await assert.rejects(
    () => client.getExample("missing"),
    (error) => {
      assert.ok(error instanceof ApiProblemError);
      assert.equal(error.problem.status, 404);
      assert.equal(error.problem.traceId, "trace-round-trip");
      return true;
    },
  );
});
