import { describe, expect, test } from "vitest";

import {
  CoordinateAdjustmentService,
  InMemoryCoordinateRepository,
} from "@on-the-road/application/location";
import { LocationCoordinatesApi } from "../../src/modules/locations/coordinates.js";

function fixture() {
  const repository = new InMemoryCoordinateRepository([{
    id: "location-1",
    ownerId: "owner-1",
    version: 1,
    status: "unresolved",
    point: null,
    manuallyAdjusted: false,
  }]);
  return {
    repository,
    api: new LocationCoordinatesApi(new CoordinateAdjustmentService(repository)),
  };
}

describe("TC-C06-01 pick, reverse failure and manual coordinate", () => {
  test("map pick remains resolved when reverse geocoding fails", async () => {
    const { api, repository } = fixture();
    const response = await api.pick("owner-1", "location-1", {
      point: { longitude: 121.4906, latitude: 31.2413, crs: "WGS84" },
      reverse: async () => {
        throw new Error("reverse unavailable");
      },
    }, { ifMatch: '"1"' });

    expect(response).toMatchObject({
      etag: '"2"',
      location: {
        status: "resolved",
        point: { longitude: 121.4906, latitude: 31.2413, crs: "WGS84" },
        manuallyAdjusted: true,
        version: 2,
      },
      reverse: { status: "failed" },
    });
    expect(repository.audits()).toContainEqual(expect.objectContaining({
      action: "location.coordinates.map-picked",
      fromVersion: 1,
      toVersion: 2,
    }));
  });

  test.each([
    [-180, -90],
    [180, 90],
    [0, 0],
  ])("manual WGS84 boundary %s,%s is persisted", async (longitude, latitude) => {
    const { api } = fixture();
    const response = await api.manual("owner-1", "location-1", {
      point: { longitude, latitude, crs: "WGS84" },
    }, { ifMatch: "W/\"1\"" });
    expect(response.location).toMatchObject({
      point: { longitude, latitude, crs: "WGS84" },
      manuallyAdjusted: true,
    });
  });
});
