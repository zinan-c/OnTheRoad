import { describe, expect, test } from "vitest";

import {
  InMemoryTransportModeRepository,
  TransportModeService,
} from "../../api/src/modules/itinerary/transport-modes.js";
import {
  TransportModeCatalog,
  TransportModeSelector,
  TransportModeSettings,
  renderTransportModeSettings,
  type TransportModeInput,
  type TransportModeView,
} from "../src/features/trips/settings/transport-modes.js";

describe("TC-B09-03 settings-to-item integration", () => {
  test("new and edited Mode visuals reach the Item selector immediately and survive refresh", async () => {
    const service = new TransportModeService(
      new InMemoryTransportModeRepository({
        trips: [{ id: "trip-a", ownerId: "owner-a" }],
      }),
    );
    const gateway = createGateway(service);
    const catalog = new TransportModeCatalog();
    const settings = new TransportModeSettings(gateway, catalog);
    const selector = new TransportModeSelector(catalog);
    await settings.load();

    const created = await settings.create({
      code: "ISLAND_BUGGY",
      label: "海岛接驳车",
      icon: "shuttle-van",
      color: "#12A594",
      lineStyle: "dashed",
    });
    expect(selector.options()).toContainEqual(
      expect.objectContaining({
        id: created.id,
        code: "ISLAND_BUGGY",
        label: "海岛接驳车",
        icon: "shuttle-van",
        color: "#12A594",
        lineStyle: "dashed",
      }),
    );
    expect(selector.select("ISLAND_BUGGY")).toMatchObject({
      label: "海岛接驳车",
    });

    await settings.update(created.id, {
      label: "海岛电瓶车",
      icon: "car-side",
      color: "#027A48",
      lineStyle: "dotted",
    });
    expect(selector.options()).toContainEqual(
      expect.objectContaining({
        code: "ISLAND_BUGGY",
        label: "海岛电瓶车",
        icon: "car-side",
        color: "#027A48",
        lineStyle: "dotted",
      }),
    );

    await settings.deactivate(created.id);
    expect(selector.options()).toContainEqual(
      expect.objectContaining({
        code: "ISLAND_BUGGY",
        enabled: false,
        warning: "已停用",
      }),
    );

    const refreshedCatalog = new TransportModeCatalog();
    const refreshedSettings = new TransportModeSettings(
      gateway,
      refreshedCatalog,
    );
    await refreshedSettings.load();
    const refreshedSelector = new TransportModeSelector(
      refreshedCatalog,
      "ISLAND_BUGGY",
    );
    expect(refreshedSelector.options()).toContainEqual(
      expect.objectContaining({
        code: "ISLAND_BUGGY",
        label: "海岛电瓶车",
        icon: "car-side",
        color: "#027A48",
        lineStyle: "dotted",
        enabled: false,
        warning: "已停用",
      }),
    );
    expect(renderTransportModeSettings(refreshedSettings)).toContain("海岛电瓶车");
  });
});

function createGateway(service: TransportModeService) {
  return {
    list: () =>
      service.list("owner-a", "trip-a") as Promise<TransportModeView[]>,
    create: (input: TransportModeInput) =>
      service.create(
        "owner-a",
        "trip-a",
        input,
      ) as Promise<TransportModeView>,
    update: (
      id: string,
      patch: Partial<Omit<TransportModeInput, "code">>,
      expectedVersion: number,
    ) =>
      service.update(
        "owner-a",
        "trip-a",
        id,
        patch,
        { expectedVersion },
      ) as Promise<TransportModeView>,
    deactivate: (id: string, expectedVersion: number) =>
      service.deactivate(
        "owner-a",
        "trip-a",
        id,
        { expectedVersion },
      ) as Promise<TransportModeView>,
  };
}
