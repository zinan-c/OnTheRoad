import assert from "node:assert/strict";
import { test } from "vitest";
import { createIdentityLinks } from "../src/public/identity-links.mjs";

test("A05 public identity links contain no provider credential", () => {
  const links = createIdentityLinks({
    apiOrigin: "https://api.example.test",
    returnTo: "/trips",
  });

  assert.equal(
    links.loginHref,
    "https://api.example.test/identity/login?returnTo=%2Ftrips",
  );
  assert.equal(links.logoutHref, "https://api.example.test/identity/logout");
  assert.doesNotMatch(JSON.stringify(links), /secret|client_id|token/iu);

  assert.equal(
    createIdentityLinks({
      apiOrigin: "https://api.example.test",
      returnTo: "//attacker.example",
    }).loginHref,
    "https://api.example.test/identity/login?returnTo=%2F",
  );
});
