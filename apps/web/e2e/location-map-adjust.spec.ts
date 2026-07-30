import { describe, expect, test } from "vitest";

import {
  CoordinateAdjustmentService,
  InMemoryCoordinateRepository,
} from "@on-the-road/application/location";
import { LocationCoordinatesApi } from "../../api/src/modules/locations/coordinates.js";
import { LocationPicker } from "../src/features/map/location-picker.js";

describe("TC-C06-03 marker drag persistence", () => {
  test.each(["mouse", "touch"] as const)(
    "%s drag persists manual coordinates, audit and refreshed center",
    async (inputMode) => {
      const repository = new InMemoryCoordinateRepository([{
        id: "location-1",
        ownerId: "owner-1",
        version: 1,
        status: "resolved",
        point: { longitude: 121.49, latitude: 31.24, crs: "WGS84" },
        manuallyAdjusted: false,
      }]);
      const api = new LocationCoordinatesApi(
        new CoordinateAdjustmentService(repository),
      );
      const gateway = {
        get: () => api.get("owner-1", "location-1"),
        drag: (
          point: { longitude: number; latitude: number; crs: "WGS84" },
          ifMatch: string,
          reportedInputMode: "mouse" | "touch" | "keyboard" | "manual",
        ) => api.drag(
          "owner-1",
          "location-1",
          { point, inputMode: reportedInputMode },
          { ifMatch },
        ),
      };
      const picker = new LocationPicker(gateway);
      await picker.load();
      await picker.dragMarker(
        { longitude: 121.5001, latitude: 31.2002, crs: "WGS84" },
        inputMode,
      );

      const refreshed = new LocationPicker(gateway);
      await refreshed.load();
      expect(refreshed.state).toMatchObject({
        version: 2,
        center: [121.5001, 31.2002],
        manuallyAdjusted: true,
      });
      expect(repository.audits()).toContainEqual(expect.objectContaining({
        action: "location.coordinates.marker-dragged",
        inputMode,
      }));
    },
  );
});
