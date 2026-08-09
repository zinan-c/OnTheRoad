import assert from "node:assert/strict";
import { describe, test } from "vitest";

import {
  CandidateTokenSigner,
  assertLocationTransition,
} from "../src/location/index.mjs";

const POINT = { longitude: 121.4737, latitude: 31.2304, crs: "WGS84" };

describe("TC-C03-01 Location state machine", () => {
  test("accepts only the documented state transitions", () => {
    for (const [current, target, options] of [
      ["unresolved", "resolving", {}],
      ["resolving", "resolved", { point: POINT }],
      ["resolving", "ambiguous", {}],
      ["resolving", "failed", {}],
      ["ambiguous", "resolved", { point: POINT }],
      ["failed", "resolving", {}],
      ["failed", "resolved", { point: POINT, manual: true }],
      ["unresolved", "resolved", { point: POINT, manual: true }],
      ["resolved", "resolved", { point: POINT, manual: true }],
    ]) {
      assert.equal(assertLocationTransition(current, target, options), target);
    }

    for (const [current, target, options] of [
      ["unresolved", "ambiguous", {}],
      ["resolved", "resolving", {}],
      ["failed", "resolved", { point: POINT }],
      ["resolved", "resolved", { point: POINT }],
      ["resolving", "resolved", {}],
      ["resolving", "failed", { manual: true }],
    ]) {
      assert.throws(
        () => assertLocationTransition(current, target, options),
        /location|resolved|manual/u,
      );
    }
  });

  test("candidate fields cannot be changed by a client", () => {
    let now = Date.parse("2026-07-29T00:00:00.000Z");
    const signer = new CandidateTokenSigner({
      secret: "tc-c03-candidate-secret-at-least-32-bytes",
      clock: () => now,
      ttlMs: 1_000,
    });
    const context = {
      ownerId: "owner-a",
      tripId: "trip-a",
      locationId: "location-a",
      locationVersion: 2,
    };
    const token = signer.sign({
      ...context,
      candidate: {
        label: "外滩",
        providerPlaceId: "fixture:bund",
        attribution: "fixture",
        countryCode: "CN",
        point: POINT,
      },
    });
    assert.deepEqual(signer.verify(token, context), {
      label: "外滩",
      providerPlaceId: "fixture:bund",
      attribution: "fixture",
      countryCode: "CN",
      point: POINT,
    });

    const [body, signature] = token.split(".");
    const tamperedBody = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
        candidate: { label: "attacker", point: POINT },
      }),
    ).toString("base64url");
    assert.throws(
      () => signer.verify(`${tamperedBody}.${signature}`, context),
      /signature/u,
    );
    assert.throws(
      () => signer.verify(token, { ...context, locationVersion: 3 }),
      /version/u,
    );
    now += 1_001;
    assert.throws(() => signer.verify(token, context), /expired/u);
  });
});
