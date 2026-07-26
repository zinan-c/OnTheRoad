import assert from "node:assert/strict";
import { test } from "vitest";
import { processKind } from "../src/index.mjs";

test("api workspace exports its process kind", () => {
  assert.equal(processKind, "api");
});
