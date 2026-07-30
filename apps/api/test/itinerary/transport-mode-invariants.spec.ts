import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";

import {
  InMemoryTransportModeRepository,
  TransportModeService,
} from "../../src/modules/itinerary/transport-modes.js";

function fixture() {
  const repository = new InMemoryTransportModeRepository({
    trips: [
      { id: "trip-a", ownerId: "owner-a" },
      { id: "trip-b", ownerId: "owner-a" },
      { id: "trip-c", ownerId: "owner-c" },
    ],
  });
  return { repository, service: new TransportModeService(repository) };
}

describe("TC-B09-02 system and referenced protection", () => {
  test("system modes cannot be edited, deactivated or deleted", async () => {
    const { service } = fixture();
    const walk = (await service.list("owner-a", "trip-a"))
      .find(({ code }) => code === "WALK")!;

    await expect(
      service.update(
        "owner-a",
        "trip-a",
        walk.id,
        { label: "改写系统步行" },
        { expectedVersion: 1 },
      ),
    ).rejects.toMatchObject({ code: "SYSTEM_TRANSPORT_MODE_PROTECTED", status: 409 });
    await expect(
      service.deactivate(
        "owner-a",
        "trip-a",
        walk.id,
        { expectedVersion: 1 },
      ),
    ).rejects.toMatchObject({ code: "SYSTEM_TRANSPORT_MODE_PROTECTED", status: 409 });
    await expect(
      service.remove("owner-a", "trip-a", walk.id, { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "SYSTEM_TRANSPORT_MODE_PROTECTED", status: 409 });
  });

  test("cross-owner/trip access is hidden and a referenced custom mode is retained inactive", async () => {
    const { repository, service } = fixture();
    const created = await service.create("owner-a", "trip-a", {
      code: "PRIVATE_BOAT",
      label: "私人快艇",
      icon: "sailboat",
      color: "#1570EF",
      lineStyle: "solid",
    });

    await expect(
      service.update(
        "owner-a",
        "trip-b",
        created.id,
        { label: "跨 Trip" },
        { expectedVersion: 1 },
      ),
    ).rejects.toMatchObject({ code: "TRANSPORT_MODE_NOT_FOUND", status: 404 });
    await expect(
      service.update(
        "owner-c",
        "trip-c",
        created.id,
        { label: "跨 owner" },
        { expectedVersion: 1 },
      ),
    ).rejects.toMatchObject({ code: "TRANSPORT_MODE_NOT_FOUND", status: 404 });

    repository.markReferenced("trip-a", "PRIVATE_BOAT");
    const retained = await service.remove(
      "owner-a",
      "trip-a",
      created.id,
      { expectedVersion: 1 },
    );
    expect(retained).toMatchObject({
      id: created.id,
      code: "PRIVATE_BOAT",
      enabled: false,
      referenced: true,
      version: 2,
    });
    expect(
      await service.resolve("owner-a", "trip-a", "PRIVATE_BOAT"),
    ).toMatchObject({ enabled: false, referenced: true });
    expect(
      await service.options("owner-a", "trip-a"),
    ).not.toContainEqual(expect.objectContaining({ code: "PRIVATE_BOAT" }));
    expect(
      await service.options("owner-a", "trip-a", {
        includeDisabledCode: "PRIVATE_BOAT",
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "PRIVATE_BOAT",
        enabled: false,
        warning: "已停用",
      }),
    );
  });

  test("database schema resolves system or same-Trip custom codes without weakening owner scope", async () => {
    const schema = await readFile(
      new URL(
        "../../../../packages/database/src/schema/transport-mode.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(schema).toMatch(/FOREIGN KEY \(trip_id, owner_id\)/);
    expect(schema).toMatch(/UNIQUE \(trip_id, code\)/);
    expect(schema).toMatch(/transport_mode_catalog/);
    expect(schema).toMatch(/reference_transport_mode r/);
    expect(schema).toMatch(/c\.trip_id = NEW\.trip_id/);
    expect(schema).toMatch(/c\.owner_id = NEW\.owner_id/);
    expect(schema).toMatch(/itinerary_transport_mode_code_guard/);
  });
});
