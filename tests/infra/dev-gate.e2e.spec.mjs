import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "vitest";

describe("TC-A02-03 development gate and Compose handoff", () => {
  test("both tracks expose the same four readiness capabilities", async () => {
    const nativeHealth = await readFile(
      new URL("../../scripts/dev-up-native-health.sh", import.meta.url),
      "utf8",
    );
    const composeHealth = await readFile(
      new URL("../../scripts/dev-up-compose-health.sh", import.meta.url),
      "utf8",
    );
    for (const capability of ["postgres", "redis", "minio", "clamav"]) {
      assert.match(nativeHealth, new RegExp(`check ${capability}`));
      assert.match(composeHealth, new RegExp(`check ${capability}`));
    }
    assert.match(nativeHealth, /fail-closed/);
    assert.match(composeHealth, /fail-closed/);
  });

  test("Compose retains release-only network and resource boundaries", async () => {
    const compose = await readFile(
      new URL("../../infra/compose/docker-compose.yml", import.meta.url),
      "utf8",
    );
    assert.equal((compose.match(/127\.0\.0\.1:/g) ?? []).length, 5);
    assert.ok((compose.match(/mem_limit:/g) ?? []).length >= 4);
    assert.ok((compose.match(/cpus:/g) ?? []).length >= 4);
    assert.match(compose, /^networks:\s*$/m);
    assert.match(compose, /^volumes:\s*$/m);
  });

  test("an incomplete Compose attempt remains a mandatory release item", async () => {
    const checklist = await readFile(
      new URL("../../docs/runbooks/release-checklist.md", import.meta.url),
      "utf8",
    );
    for (const requirement of [
      "clean-volume Compose start",
      "PostGIS extension",
      "EICAR fixture",
      "fail closed",
      "blocks release",
    ]) {
      assert.match(checklist, new RegExp(requirement, "i"));
    }
  });
});
