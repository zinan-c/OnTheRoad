import { cp, mkdir } from "node:fs/promises";

const source = new URL("../src/", import.meta.url);
const target = new URL("../dist/", import.meta.url);
await mkdir(target, { recursive: true });
for (const directory of ["migrations", "schema"]) {
  await cp(new URL(`${directory}/`, source), new URL(`${directory}/`, target), {
    recursive: true,
  });
}
