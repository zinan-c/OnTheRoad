import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

import { loadProcessConfig } from "../../packages/config/src/env.js";

function parseExample(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        assert.ok(separator > 0, `invalid .env.example line: ${line}`);
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

test("TC-A03-03 .env.example boots with explicit fixture capabilities", async () => {
  const source = await readFile(new URL("../../.env.example", import.meta.url), "utf8");
  const environment = parseExample(source);
  const config = loadProcessConfig("api", environment);

  assert.equal(environment.AMAP_API_KEY, "");
  assert.equal(environment.AMAP_JS_API_KEY, "");
  assert.equal(environment.AMAP_JS_SECURITY_CODE, "");
  assert.equal(environment.MAP_PROFILE, "fixture");
  assert.equal(environment.OTR_MAP_DEFAULT_LAYER, "amap-street");
  assert.equal(environment.OTR_DIRECTIONS_BASE_URL, "https://restapi.amap.com/");
  assert.equal(environment.OTR_STATIC_MAP_BASE_URL, "https://restapi.amap.com/v3/staticmap");
  assert.equal(environment.OTR_NOMINATIM_BASE_URL, "https://nominatim.openstreetmap.org");
  assert.deepEqual(config.map.capabilities, {
    autocomplete: false,
    batchGeocoding: false,
    explicitSearch: false,
    offlineMap: true,
  });
});
