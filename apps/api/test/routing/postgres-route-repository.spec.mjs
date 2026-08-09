import { describe, expect, test, vi } from "vitest";

import { PostgresRouteRepository } from "../../src/modules/routing/postgres-route-repository.mjs";

describe("PostgresRouteRepository", () => {
  test("returns only active persisted geometry with provider and authoritative endpoints", async () => {
    const json = vi.fn().mockResolvedValue([]);
    const repository = new PostgresRouteRepository({ executor: { json } });

    await repository.list("owner-1", "00000000-0000-4000-8000-000000000016");

    const [sql, values] = json.mock.calls[0];
    expect(sql).toContain("'fromLocationId', segment.from_location_id");
    expect(sql).toContain("'toLocationId', segment.to_location_id");
    expect(sql).toContain("'provider', segment.route_provider");
    expect(sql).toContain("ST_AsGeoJSON(segment.route_geometry)");
    expect(sql).toContain("segment.status <> 'obsolete'");
    expect(values).toEqual(["owner-1", "00000000-0000-4000-8000-000000000016"]);
  });
});
