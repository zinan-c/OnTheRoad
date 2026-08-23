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
        const rawValue = line.slice(separator + 1);
        const value = /^(['"])(.*)\1$/u.exec(rawValue)?.[2] ?? rawValue;
        return [line.slice(0, separator), value];
      }),
  );
}

test(".env.example quotes values containing whitespace for shell loading", async () => {
  const source = await readFile(new URL("../../.env.example", import.meta.url), "utf8");
  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    assert.ok(separator > 0, `invalid .env.example line: ${line}`);
    const rawValue = trimmed.slice(separator + 1);
    if (/\s/u.test(rawValue)) {
      assert.match(rawValue, /^(?:'.*'|".*")$/u, `shell-unsafe value: ${line}`);
    }
  }
});

test("TC-A03-03 .env.example boots with explicit fixture capabilities", async () => {
  const source = await readFile(new URL("../../.env.example", import.meta.url), "utf8");
  const environment = parseExample(source);
  const config = loadProcessConfig("api", environment);

  assert.equal(environment.AMAP_API_KEY, "");
  assert.equal(environment.AMAP_JS_API_KEY, "");
  assert.equal(environment.AMAP_JS_SECURITY_CODE, "");
  assert.equal(environment.MAP_PROFILE, "fixture");
  assert.equal(environment.OTR_MAP_DEFAULT_LAYER, "amap-street");
  assert.equal(environment.OTR_DIRECTIONS_ATTRIBUTION, "© 高德地图");
  assert.equal(environment.OTR_STATIC_MAP_ATTRIBUTION, "© 高德地图");
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
