import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";

export const runtime = "nodejs";

type Color = readonly [number, number, number];
type Point = readonly [number, number];
type TilePoint = readonly [number, number];
type Tile = { readonly z: number; readonly x: number; readonly y: number };

const TILE_SIZE = 256;
const OCEAN: Color = [226, 239, 246];
const GRID: Color = [194, 216, 224];
const LAND: Color = [231, 239, 222];
const LAND_EDGE: Color = [166, 190, 160];
const ROAD_EDGE: Color = [183, 196, 172];
const ROAD_SURFACE: Color = [255, 255, 255];
const CITY: Color = [129, 158, 135];
const TILE_CACHE = new Map<string, ArrayBuffer>();

// A deliberately small, offline outline of the Philippines/Visayas. It is
// not intended to replace a production basemap; it gives the fixture profile
// geographic context without calling a public tile service or requiring a key.
const LAND_POLYGONS: readonly (readonly Point[])[] = [
  // Luzon and nearby islands.
  [[119.3, 21.2], [121.8, 18.4], [122.4, 15.6], [121.3, 13.0], [119.6, 13.1], [118.7, 16.5]],
  // Panay.
  [[121.5, 11.9], [122.8, 11.8], [123.4, 10.8], [122.5, 10.0], [121.5, 10.4], [120.9, 11.3]],
  // Negros.
  [[122.5, 11.1], [123.4, 10.9], [123.6, 9.1], [122.7, 8.4], [122.2, 9.5]],
  // Cebu.
  [[123.2, 11.4], [124.0, 11.2], [124.1, 10.2], [123.8, 9.4], [123.2, 9.4], [122.9, 10.4]],
  // Bohol.
  [[123.5, 10.4], [124.6, 10.3], [124.7, 9.6], [124.1, 9.2], [123.5, 9.4]],
  // Mindanao's north-western edge for regional context.
  [[123.0, 8.9], [124.5, 9.1], [126.4, 8.6], [126.8, 7.1], [124.5, 6.5], [123.0, 7.3]],
  // Palawan's eastern edge.
  [[117.2, 12.8], [118.7, 12.5], [119.4, 10.7], [118.5, 9.0], [117.6, 9.6]],
];

const ROAD_LINES: readonly (readonly Point[])[] = [
  [[121.2, 11.4], [122.2, 10.8], [123.0, 10.4]],
  [[122.7, 10.7], [123.1, 9.4]],
  [[123.4, 11.1], [123.7, 10.1], [123.8, 9.5]],
  [[123.6, 10.0], [124.3, 9.7]],
  [[123.1, 8.8], [124.4, 8.3]],
];

const CITY_POINTS: readonly Point[] = [
  [123.8854, 10.3157], // Cebu City
  [123.9790, 10.3076], // Mactan
  [123.8486, 9.6415], // Tagbilaran
  [123.7610, 9.5506], // Panglao
  [123.5127, 9.2142], // Siquijor
  [123.3080, 9.3070], // Dumaguete
  [123.4120, 9.5190], // Oslob
  [123.3950, 9.9430], // Moalboal
];

export async function GET(
  _request: Request,
  context: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const tile = normalizeTile(await context.params);
  const key = `${tile.z}/${tile.x}/${tile.y}`;
  let fixtureTile = TILE_CACHE.get(key);
  if (!fixtureTile) {
    fixtureTile = createFixtureTile(tile);
    TILE_CACHE.set(key, fixtureTile);
  }
  return new Response(fixtureTile, {
    headers: {
      // MapLibre's raster loader accepts PNG/JPEG, but deliberately rejects SVG.
      "content-type": "image/png",
      "cache-control": "public, max-age=3600",
      "x-otr-map-provider": "fixture",
    },
  });
}

function normalizeTile(params: { z: string; x: string; y: string }): Tile {
  const z = Number.parseInt(params.z, 10);
  const safeZoom = Number.isSafeInteger(z) ? Math.max(0, Math.min(22, z)) : 0;
  const tileCount = 2 ** safeZoom;
  const parsedX = Number.parseInt(params.x, 10);
  const parsedY = Number.parseInt(params.y, 10);
  const x = Number.isSafeInteger(parsedX)
    ? ((parsedX % tileCount) + tileCount) % tileCount
    : 0;
  const y = Number.isSafeInteger(parsedY)
    ? Math.max(0, Math.min(tileCount - 1, parsedY))
    : 0;
  return { z: safeZoom, x, y };
}

function createFixtureTile(tile: Tile): ArrayBuffer {
  const rowSize = TILE_SIZE * 3;
  const pixels = Buffer.alloc(TILE_SIZE * rowSize);
  fill(pixels, OCEAN);

  drawGrid(pixels, tile);
  for (const polygon of LAND_POLYGONS) drawProjectedPolygon(pixels, polygon, tile);
  for (const road of ROAD_LINES) drawProjectedRoad(pixels, road, tile);
  for (const city of CITY_POINTS) drawProjectedCity(pixels, city, tile);

  const scanlines = Buffer.alloc((rowSize + 1) * TILE_SIZE);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    const scanlineOffset = y * (rowSize + 1);
    scanlines[scanlineOffset] = 0;
    pixels.copy(scanlines, scanlineOffset + 1, y * rowSize, (y + 1) * rowSize);
  }

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", Buffer.from([0, 0, 1, 0, 0, 0, 1, 0, 8, 2, 0, 0, 0])),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
}

function drawGrid(pixels: Buffer, tile: Tile): void {
  const step = tile.z < 4 ? 30 : tile.z < 7 ? 10 : tile.z < 9 ? 5 : 1;
  const worldSize = TILE_SIZE * (2 ** tile.z);
  const originX = tile.x * TILE_SIZE;
  const originY = tile.y * TILE_SIZE;
  for (let longitude = -180; longitude <= 180; longitude += step) {
    const worldX = project([longitude, 0], worldSize)[0] - originX;
    drawLine(pixels, [worldX, 0], [worldX, TILE_SIZE - 1], 1, GRID);
  }
  for (let latitude = -80; latitude <= 80; latitude += step) {
    const worldY = project([0, latitude], worldSize)[1] - originY;
    drawLine(pixels, [0, worldY], [TILE_SIZE - 1, worldY], 1, GRID);
  }
}

function drawProjectedPolygon(pixels: Buffer, polygon: readonly Point[], tile: Tile): void {
  const worldSize = TILE_SIZE * (2 ** tile.z);
  const originX = tile.x * TILE_SIZE;
  const originY = tile.y * TILE_SIZE;
  // Draw one wrapped copy on either side so world-edge tiles remain stable.
  for (const wrap of [-worldSize, 0, worldSize]) {
    const projected = polygon.map((point) => {
      const [x, y] = project(point, worldSize);
      return [x - originX + wrap, y - originY] as TilePoint;
    });
    drawPolygon(pixels, projected, LAND, LAND_EDGE);
  }
}

function drawProjectedRoad(pixels: Buffer, road: readonly Point[], tile: Tile): void {
  const worldSize = TILE_SIZE * (2 ** tile.z);
  const originX = tile.x * TILE_SIZE;
  const originY = tile.y * TILE_SIZE;
  const projected = road.map((point) => {
    const [x, y] = project(point, worldSize);
    return [x - originX, y - originY] as TilePoint;
  });
  for (let index = 1; index < projected.length; index += 1) {
    const from = projected[index - 1]!;
    const to = projected[index]!;
    drawLine(pixels, from, to, tile.z >= 8 ? 4 : 2, ROAD_SURFACE);
    drawLine(pixels, from, to, 1, ROAD_EDGE);
  }
}

function drawProjectedCity(pixels: Buffer, point: Point, tile: Tile): void {
  const worldSize = TILE_SIZE * (2 ** tile.z);
  const [x, y] = project(point, worldSize);
  const local: TilePoint = [x - tile.x * TILE_SIZE, y - tile.y * TILE_SIZE];
  drawCircle(pixels, local, tile.z >= 8 ? 3 : 2, CITY);
}

function project([longitude, latitude]: Point, worldSize: number): TilePoint {
  const radians = Math.max(-0.9999, Math.min(0.9999, Math.sin((latitude * Math.PI) / 180)));
  return [
    ((longitude + 180) / 360) * worldSize,
    (0.5 - Math.log((1 + radians) / (1 - radians)) / (4 * Math.PI)) * worldSize,
  ];
}

function drawPolygon(pixels: Buffer, points: readonly TilePoint[], fillColor: Color, edgeColor: Color): void {
  if (points.length < 3) return;
  const minY = Math.max(0, Math.floor(Math.min(...points.map(([, y]) => y))));
  const maxY = Math.min(TILE_SIZE - 1, Math.ceil(Math.max(...points.map(([, y]) => y))));
  for (let y = minY; y <= maxY; y += 1) {
    const intersections: number[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const [x1, y1] = points[index]!;
      const [x2, y2] = points[(index + 1) % points.length]!;
      if ((y1 > y) === (y2 > y) || y1 === y2) continue;
      intersections.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const start = Math.max(0, Math.ceil(intersections[index]!));
      const end = Math.min(TILE_SIZE - 1, Math.floor(intersections[index + 1]!));
      for (let x = start; x <= end; x += 1) setPixel(pixels, x, y, fillColor);
    }
  }
  for (let index = 0; index < points.length; index += 1) {
    drawLine(pixels, points[index]!, points[(index + 1) % points.length]!, 1, edgeColor);
  }
}

function drawCircle(pixels: Buffer, center: TilePoint, radius: number, color: Color): void {
  const minX = Math.max(0, Math.floor(center[0] - radius));
  const maxX = Math.min(TILE_SIZE - 1, Math.ceil(center[0] + radius));
  const minY = Math.max(0, Math.floor(center[1] - radius));
  const maxY = Math.min(TILE_SIZE - 1, Math.ceil(center[1] + radius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if ((x - center[0]) ** 2 + (y - center[1]) ** 2 <= radius ** 2) setPixel(pixels, x, y, color);
    }
  }
}

function fill(pixels: Buffer, color: Color): void {
  for (let offset = 0; offset < pixels.length; offset += 3) {
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
  }
}

function setPixel(pixels: Buffer, x: number, y: number, color: Color): void {
  if (x < 0 || x >= TILE_SIZE || y < 0 || y >= TILE_SIZE) return;
  const offset = (y * TILE_SIZE + x) * 3;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
}

function drawLine(pixels: Buffer, from: TilePoint, to: TilePoint, width: number, color: Color): void {
  const radius = width / 2;
  const minX = Math.max(0, Math.floor(Math.min(from[0], to[0]) - radius));
  const maxX = Math.min(TILE_SIZE - 1, Math.ceil(Math.max(from[0], to[0]) + radius));
  const minY = Math.max(0, Math.floor(Math.min(from[1], to[1]) - radius));
  const maxY = Math.min(TILE_SIZE - 1, Math.ceil(Math.max(from[1], to[1]) + radius));
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const projection = lengthSquared === 0
        ? 0
        : ((x - from[0]) * dx + (y - from[1]) * dy) / lengthSquared;
      const clamped = Math.max(0, Math.min(1, projection));
      const closestX = from[0] + clamped * dx;
      const closestY = from[1] + clamped * dy;
      if ((x - closestX) ** 2 + (y - closestY) ** 2 <= radius ** 2) setPixel(pixels, x, y, color);
    }
  }
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(data.byteLength + 12);
  chunk.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(chunk, 4);
  Buffer.from(data).copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), data.byteLength + 8);
  return chunk;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
