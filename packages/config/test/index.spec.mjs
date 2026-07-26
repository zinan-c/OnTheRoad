import assert from "node:assert/strict";
import { test } from "vitest";
import { workspaceName } from "../src/index.mjs";

test("config package has a stable workspace name", () => {
  assert.equal(workspaceName, "config");
});
