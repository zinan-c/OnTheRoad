import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const spikeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(spikeRoot, "src/public");
const maplibreRoot = path.dirname(require.resolve("maplibre-gl/package.json"));

const routes = new Map([
  ["/", [path.join(publicRoot, "index.html"), "text/html; charset=utf-8"]],
  ["/app.js", [path.join(publicRoot, "app.js"), "text/javascript; charset=utf-8"]],
  ["/app.css", [path.join(publicRoot, "app.css"), "text/css; charset=utf-8"]],
  [
    "/src/map-contract.mjs",
    [path.join(spikeRoot, "src/map-contract.mjs"), "text/javascript; charset=utf-8"],
  ],
  [
    "/src/fixture.ts",
    [path.join(spikeRoot, "src/fixture.ts"), "text/javascript; charset=utf-8"],
  ],
  [
    "/vendor/maplibre-gl.css",
    [path.join(maplibreRoot, "dist/maplibre-gl.css"), "text/css; charset=utf-8"],
  ],
]);

const FIXTURE_TILE = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="#e8eee8"/>
  <path d="M0 64H256M0 128H256M0 192H256M64 0V256M128 0V256M192 0V256" stroke="#c4d0c8" stroke-width="1"/>
  <path d="M-20 210L65 132L123 148L202 48L280 81" fill="none" stroke="#b9c4ba" stroke-width="12"/>
  <path d="M-20 210L65 132L123 148L202 48L280 81" fill="none" stroke="#f8faf7" stroke-width="7"/>
</svg>`;

export async function startServer(): Promise<{
  origin: string;
  close: () => Promise<void>;
}> {
  const server = createServer(async (request: any, response: any) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (/^\/fixture-tiles\/\d+\/\d+\/\d+\.svg$/.test(pathname)) {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "image/svg+xml",
      });
      response.end(FIXTURE_TILE);
      return;
    }
    const vendorMatch = pathname.match(
      /^\/vendor\/(maplibre-gl(?:-shared|-worker)?(?:-dev)?\.mjs)$/,
    );
    const route =
      routes.get(pathname) ??
      (vendorMatch
        ? [
            path.join(maplibreRoot, "dist", vendorMatch[1]),
            "text/javascript; charset=utf-8",
          ]
        : undefined);
    if (!route) {
      response.writeHead(pathname.startsWith("/tiles/") ? 503 : 404, {
        "content-type": "text/plain; charset=utf-8",
      });
      response.end(pathname.startsWith("/tiles/") ? "fixture tile unavailable" : "not found");
      return;
    }
    try {
      const [filePath, contentType] = route;
      const body = await readFile(filePath);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": contentType,
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "read failed");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo | null;
  if (!address || typeof address === "string") throw new Error("A09_SERVER_BIND_FAILED");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error: Error | undefined) => (error ? reject(error) : resolve())),
      ),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const running = await startServer();
  process.stdout.write(`${running.origin}\n`);
}
