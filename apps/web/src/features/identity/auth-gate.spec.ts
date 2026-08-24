import { describe, expect, test } from "vitest";

import { loginHref, safeReturnTo } from "./auth-gate";

describe("identity navigation helpers", () => {
  test("accepts same-origin application paths and rejects open redirects", () => {
    expect(safeReturnTo("/trips?status=active")).toBe("/trips?status=active");
    expect(safeReturnTo("//evil.example")).toBe("/trips");
    expect(safeReturnTo("https://evil.example")).toBe("/trips");
    expect(loginHref("/trips/abc")).toBe("/login?returnTo=%2Ftrips%2Fabc");
  });
});
