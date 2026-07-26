import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export { generateFixtures, hashFixtureTree } from "./generator.mjs";
export { validateMinimalFiveDay } from "./validation.mjs";
export {
  consumeImporterFixture,
  consumeMapFixture,
  consumePdfTextFixture,
  consumeProviderFixture,
} from "./consumers.mjs";

import { containsExternalReference } from "./generator.mjs";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const FIXTURE_ROOT = pathToFileURL(PACKAGE_ROOT).href;
export const FIXTURE_PACKAGE_PATH = PACKAGE_ROOT;

export async function loadMinimalFiveDay() {
  return JSON.parse(await readFile(join(PACKAGE_ROOT, "src/trips/minimal-five-day.json"), "utf8"));
}

export async function loadAssetManifest() {
  return JSON.parse(await readFile(join(PACKAGE_ROOT, "manifest.json"), "utf8"));
}

export async function assertOfflineAssetReferences(manifest) {
  const errors = [];
  if (manifest.networkRequired !== false) errors.push("manifest must declare networkRequired=false");
  for (const path of Object.keys(manifest.assets ?? {})) {
    const content = await readFile(join(PACKAGE_ROOT, path));
    if (containsExternalReference(content)) errors.push(`external reference in ${path}`);
  }
  return errors;
}
