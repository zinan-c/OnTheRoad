import assert from "node:assert/strict";
import { test } from "vitest";

import {
  boundsForPoints,
  normalizeWgs84,
  selectionEvent,
} from "./src/map-contract.mjs";

test("TC-A09-01 emits selection and valid WGS84 after click/drag", () => {
  const clicked = selectionEvent("map-click", [121.4737, 31.2304]);
  const dragged = selectionEvent("marker-drag", [122.1069, 30.0197]);

  assert.deepEqual(clicked, {
    type: "location-selected",
    source: "map-click",
    point: { longitude: 121.4737, latitude: 31.2304 },
  });
  assert.equal(dragged.point.longitude, 122.1069);
  assert.equal(dragged.point.latitude, 30.0197);
  assert.throws(() => normalizeWgs84([181, 31]), /WGS84_OUT_OF_RANGE/);
  assert.throws(() => normalizeWgs84([121, -91]), /WGS84_OUT_OF_RANGE/);
});

test("TC-A09-01 computes deterministic fit bounds for 0/1/same/many points", () => {
  assert.equal(boundsForPoints([]), null);
  assert.deepEqual(boundsForPoints([[121.5, 31.2]]), [
    [121.45, 31.15],
    [121.55, 31.25],
  ]);
  assert.deepEqual(
    boundsForPoints([
      [121.5, 31.2],
      [121.5, 31.2],
    ]),
    [
      [121.45, 31.15],
      [121.55, 31.25],
    ],
  );
  assert.deepEqual(
    boundsForPoints([
      [121.47, 31.23],
      [122.1, 30.02],
    ]),
    [
      [121.47, 30.02],
      [122.1, 31.23],
    ],
  );
});
