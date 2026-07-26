import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { generateFixtures } from "../src/generator.mjs";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = await generateFixtures(packageRoot);
process.stdout.write(`${manifest.fixtureVersion} ${manifest.treeSha256}\n`);
