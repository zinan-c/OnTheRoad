import assert from "node:assert/strict";
import { test } from "vitest";
import {
  ProblemDetailsError,
  toProblemDetails,
} from "../src/common/problem-details/index.mjs";

test("TC-A04-02 unknown errors expose code/status/traceId but never a stack", () => {
  const traceId = "01J5Y3ZJ8M3PWKCC57JMKJCFYN";
  const problem = toProblemDetails(new Error("database password leaked"), traceId);

  assert.equal(problem.status, 500);
  assert.equal(problem.code, "INTERNAL_ERROR");
  assert.equal(problem.traceId, traceId);
  assert.equal(problem.detail, "An unexpected error occurred.");
  assert.equal("stack" in problem, false);
  assert.equal(JSON.stringify(problem).includes("database password leaked"), false);
});

test("TC-A04-02 known problems retain safe public details", () => {
  const problem = toProblemDetails(
    new ProblemDetailsError({
      status: 400,
      code: "VALIDATION_FAILED",
      title: "Request validation failed",
      detail: "The date field must use YYYY-MM-DD.",
      errors: [{ field: "date", message: "Invalid date" }],
    }),
    "trace-known",
  );

  assert.equal(problem.status, 400);
  assert.equal(problem.traceId, "trace-known");
  assert.deepEqual(problem.errors, [{ field: "date", message: "Invalid date" }]);
});
