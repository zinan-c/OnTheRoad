import { describe, expect, test } from "vitest";

import {
  TransportModeCatalog,
  TransportModeSelector,
  TransportModeSettings,
  renderTransportModeSettings,
  validateInput,
} from "../../../src/features/trips/settings/transport-modes.js";

describe("B09 transport Mode settings form", () => {
  test("associates accessible fields and prevents invalid visual configuration", async () => {
    const settings = new TransportModeSettings({
      list: async () => [],
      create: async (input) => ({
        id: "custom-1",
        tripId: "trip-a",
        ownerId: "owner-a",
        ...input,
        isSystem: false,
        enabled: true,
        referenced: false,
        version: 1,
      }),
      update: async () => {
        throw new Error("not used");
      },
      deactivate: async () => {
        throw new Error("not used");
      },
    });
    const html = renderTransportModeSettings(settings);
    expect(html).toContain('for="mode-code"');
    expect(html).toContain('aria-label="新增自定义交通方式"');
    expect(validateInput({
      code: "bad code",
      label: "",
      icon: "<svg>",
      color: "red",
      lineStyle: "solid",
    })).toMatchObject({
      code: expect.any(String),
      label: expect.any(String),
      icon: expect.any(String),
      color: expect.any(String),
    });
    await expect(settings.create({
      code: "bad code",
      label: "",
      icon: "<svg>",
      color: "red",
      lineStyle: "solid",
    })).rejects.toThrow(/invalid/i);
  });

  test("disabled selected Modes remain readable but cannot be newly selected", () => {
    const catalog = new TransportModeCatalog();
    catalog.replace([{
      id: "custom-1",
      tripId: "trip-a",
      ownerId: "owner-a",
      code: "OLD_BOAT",
      label: "旧船",
      icon: "ship",
      color: "#1570EF",
      lineStyle: "solid",
      isSystem: false,
      enabled: false,
      referenced: true,
      version: 2,
    }]);
    const selected = new TransportModeSelector(catalog, "OLD_BOAT");
    expect(selected.options()[0]).toMatchObject({ warning: "已停用" });
    expect(() => selected.select("OLD_BOAT")).toThrow(/unavailable/i);
  });
});
