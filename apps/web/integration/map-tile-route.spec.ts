import { describe, expect, test } from "vitest";

import { GET } from "../src/app/api/map/tiles/[z]/[x]/[y]/route";

describe("fixture map tile route", () => {
  test("returns a PNG that MapLibre can use as a raster tile", async () => {
    const response = await GET(
      new Request("http://localhost/api/map/tiles/12/3398/1684"),
      { params: Promise.resolve({ z: "12", x: "3398", y: "1684" }) },
    );
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-otr-map-provider")).toBe("fixture");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(16)).toBe(256);
    expect(view.getUint32(20)).toBe(256);
  });

  test("uses tile coordinates so adjacent tiles do not repeat one texture", async () => {
    const first = await GET(
      new Request("http://localhost/api/map/tiles/6/54/30"),
      { params: Promise.resolve({ z: "6", x: "54", y: "30" }) },
    );
    const adjacent = await GET(
      new Request("http://localhost/api/map/tiles/6/55/30"),
      { params: Promise.resolve({ z: "6", x: "55", y: "30" }) },
    );
    expect([...new Uint8Array(await first.arrayBuffer())]).not.toEqual(
      [...new Uint8Array(await adjacent.arrayBuffer())],
    );
  });
});
