import assert from "node:assert/strict";
import { test } from "vitest";
import { workspaceName } from "../src/index.mjs";

test("domain package has a stable workspace name", () => {
  assert.equal(workspaceName, "domain");
});
