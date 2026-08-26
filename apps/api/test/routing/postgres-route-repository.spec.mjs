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
      failedDays: 0,
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
    expect(sql).toContain("failed_event_days");
    expect(sql).toContain("failedDays");
    expect(sql).toContain("resolved_with_geometry");
    expect(sql).toContain("status = 'resolved' AND route_geometry IS NOT NULL");
    expect(sql).toContain("THEN 'partial'");
    expect(sql).toContain("event.handled_at IS NULL");
    expect(sql).toContain("event.handled_at IS NOT NULL");
    expect(values).toEqual(["owner-1", "00000000-0000-4000-8000-000000000016"]);
  });

  test("exposes terminal failure states without treating failed events as pending", async () => {
    const json = vi.fn().mockResolvedValue({
      status: "failed",
      generations: [],
      pendingDays: 0,
      blockedSegments: 0,
      failedSegments: 0,
      failedDays: 1,
      pollAfterMs: 1500,
    });
    const repository = new PostgresRouteRepository({ executor: { json } });

    await expect(repository.status("owner-1", "trip-1")).resolves.toMatchObject({
      status: "failed",
      failedDays: 1,
    });
    const [sql] = json.mock.calls[0];
    expect(sql).toContain("event.aggregate_version = day.route_generation");
    expect(sql).toContain("'failedDays'");
  });

  test("returns partial when persisted geometry survives alongside route failures", async () => {
    const json = vi.fn().mockResolvedValue({
      status: "partial",
      generations: [],
      pendingDays: 0,
      blockedSegments: 2,
      failedSegments: 8,
      failedDays: 1,
      pollAfterMs: 1500,
    });
    const repository = new PostgresRouteRepository({ executor: { json } });

    await expect(repository.status("owner-1", "trip-1")).resolves.toMatchObject({
      status: "partial",
      pendingDays: 0,
      failedSegments: 8,
    });
  });
});
