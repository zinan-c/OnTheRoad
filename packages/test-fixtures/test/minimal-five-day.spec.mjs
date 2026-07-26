import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

import {
  FIXTURE_ROOT,
  loadMinimalFiveDay,
  validateMinimalFiveDay,
} from "../src/index.mjs";

test("TC-A12-01 minimal-five-day satisfies schema and invariants", async () => {
  const fixture = await loadMinimalFiveDay();
  const errors = validateMinimalFiveDay(fixture);

  assert.deepEqual(errors, []);
  assert.equal(fixture.fixtureVersion, "minimal-five-day@1");
  assert.equal(fixture.trip.days.length, 5);

  const dates = fixture.trip.days.map(({ date }) => Date.parse(`${date}T00:00:00Z`));
  for (let index = 1; index < dates.length; index += 1) {
    assert.equal(dates[index] - dates[index - 1], 86_400_000);
  }

  const locationIds = new Set(fixture.locations.map(({ id }) => id));
  for (const location of fixture.locations) {
    assert.ok(location.longitude >= -180 && location.longitude <= 180);
    assert.ok(location.latitude >= -90 && location.latitude <= 90);
    assert.equal(location.crs, "WGS84");
  }
  for (const day of fixture.trip.days) {
    for (const item of day.items) {
      assert.ok(locationIds.has(item.locationId), `missing location ${item.locationId}`);
    }
  }
  for (const route of fixture.routes) {
    assert.ok(locationIds.has(route.fromLocationId));
    assert.ok(locationIds.has(route.toLocationId));
  }

  for (const relativePath of fixture.assets.all) {
    await access(new URL(relativePath, `${FIXTURE_ROOT}/`));
  }
});
