import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "vitest";

describe("development environment shutdown", () => {
  test("pnpm stop targets only fingerprinted project processes and all dependencies", async () => {
    const packageJson = JSON.parse(await readFile(
      new URL("../../package.json", import.meta.url),
      "utf8",
    ));
    const runner = await readFile(
      new URL("../../scripts/run-environment.sh", import.meta.url),
      "utf8",
    );
    const stop = await readFile(
      new URL("../../scripts/stop-environment.sh", import.meta.url),
      "utf8",
    );

    assert.equal(packageJson.scripts.stop, "bash scripts/stop-environment.sh native");
    for (const [service, command] of [
      ["app-api", "pnpm run start:api"],
      ["app-worker", "pnpm run start:worker"],
      ["app-web", "pnpm run start:web"],
    ]) {
      assert.match(runner, new RegExp(`stack_record_pid "${service}".*"${command}"`));
      assert.match(stop, new RegExp(`stop_application ${service} .*"${command}"`));
    }
    assert.match(stop, /stack_read_owned_pid/u);
    assert.match(stop, /dev-down\.sh" --track/u);
    assert.doesNotMatch(stop, /lsof.*kill|kill.*lsof/u);
    assert.doesNotMatch(stop, /kill\s+-KILL|kill\s+-9/u);
  });
});
