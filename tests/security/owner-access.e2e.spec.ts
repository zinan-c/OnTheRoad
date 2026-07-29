import assert from "node:assert/strict";
import { test } from "vitest";
import {
  ResourceNotFoundError,
  assertResourceOwner,
  createPrincipal,
} from "../../packages/domain/src/identity/index.mjs";

test("TC-A05-02 cross-owner access does not reveal resource existence", () => {
  const userA = createPrincipal({
    issuer: "https://identity.test",
    subject: "user-a",
  });
  const userB = createPrincipal({
    issuer: "https://identity.test",
    subject: "user-b",
  });
  const resources = [
    { id: "trip-a", ownerId: userA.id },
    { id: "day-a", ownerId: userA.id },
    { id: "attachment-a", ownerId: userA.id },
  ];

  for (const resource of resources) {
    assert.equal(assertResourceOwner(userA, resource), resource);
    assert.throws(
      () => assertResourceOwner(userB, resource),
      (error) =>
        error instanceof ResourceNotFoundError
        && error.status === 404
        && error.code === "RESOURCE_NOT_FOUND"
        && !error.message.includes(resource.id)
        && !error.message.includes(userA.id),
    );
  }
});
