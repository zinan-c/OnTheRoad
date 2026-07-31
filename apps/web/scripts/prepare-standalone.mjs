import { cp, mkdir } from "node:fs/promises";

const standaloneRoot = new URL("../.next/standalone/apps/web/", import.meta.url);
await mkdir(new URL(".next/", standaloneRoot), { recursive: true });
await cp(
  new URL("../.next/static/", import.meta.url),
  new URL(".next/static/", standaloneRoot),
  { recursive: true, force: true },
);
