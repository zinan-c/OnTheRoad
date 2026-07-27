import assert from "node:assert/strict";
import { test } from "vitest";
import {
  assertBackwardCompatible,
  readContract,
} from "../../../scripts/generate-client.mjs";

test("TC-A04-02 breaking changes are rejected when a required response field is removed", async () => {
  const baseline = await readContract();
  const changed = JSON.parse(JSON.stringify(baseline));
  changed.components.schemas.ExampleResource.required =
    changed.components.schemas.ExampleResource.required.filter((field) => field !== "date");

  assert.throws(
    () => assertBackwardCompatible(baseline, changed),
    /ExampleResource.*date/u,
  );
});
