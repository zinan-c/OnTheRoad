import { access, cp, mkdir } from "node:fs/promises";

const standaloneRoot = new URL("../.next/standalone/apps/web/", import.meta.url);
await mkdir(new URL(".next/", standaloneRoot), { recursive: true });
await cp(
  new URL("../.next/static/", import.meta.url),
  new URL(".next/static/", standaloneRoot),
  { recursive: true, force: true },
);

// Next's standalone trace currently omits this Turbopack server manifest.
// Without it, static routes render but dynamic App Router routes fail while
// resolving their client-reference manifest (Next invariant E951).
const interceptionManifest = "server/interception-route-rewrite-manifest.js";
await cp(
  new URL(`../.next/${interceptionManifest}`, import.meta.url),
  new URL(`.next/${interceptionManifest}`, standaloneRoot),
  { force: true },
);

await Promise.all([
  access(new URL(".next/static/", standaloneRoot)),
  access(new URL(`.next/${interceptionManifest}`, standaloneRoot)),
]);
