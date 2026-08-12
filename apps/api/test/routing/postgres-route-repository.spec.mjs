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

  test("reads a finite generation status from outbox, generations, and active segments", async () => {
    const snapshot = {
      status: "loading",
      generations: [{ dayId: "00000000-0000-4000-8000-000000000017", dayNumber: 1, routeGeneration: 3 }],
      pendingDays: 1,
      blockedSegments: 1,
      failedSegments: 0,
      pollAfterMs: 1500,
    };
    const json = vi.fn().mockResolvedValue(snapshot);
    const repository = new PostgresRouteRepository({ executor: { json } });

    await expect(repository.status("owner-1", "00000000-0000-4000-8000-000000000016"))
      .resolves.toEqual(snapshot);

    const [sql, values] = json.mock.calls[0];
    expect(sql).toContain("job_outbox");
    expect(sql).toContain("route.rebuild.requested");
    expect(sql).toContain("routeGenerations");
    expect(sql).toContain("blockedSegments");
    expect(values).toEqual(["owner-1", "00000000-0000-4000-8000-000000000016"]);
  });
});
