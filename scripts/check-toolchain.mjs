import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const expectedNode = manifest.engines.node;
const expectedPnpm = manifest.packageManager.replace(/^pnpm@/, "");
const actualNode =
  process.env.TOOLCHAIN_NODE_VERSION_OVERRIDE ?? process.versions.node;
const pnpmResult = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
const actualPnpm =
  process.env.TOOLCHAIN_PNPM_VERSION_OVERRIDE ??
  (pnpmResult.status === 0 ? pnpmResult.stdout.trim() : "not installed");

const errors = [];
if (actualNode !== expectedNode) {
  errors.push(`Node ${expectedNode} is required; received ${actualNode}. Run: nvm use`);
}
if (actualPnpm !== expectedPnpm) {
  errors.push(
    `pnpm ${expectedPnpm} is required; received ${actualPnpm}. Run: corepack prepare pnpm@${expectedPnpm} --activate`,
  );
}

if (errors.length > 0) {
  console.error(`Toolchain check failed:\n- ${errors.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`Toolchain OK: Node ${actualNode}, pnpm ${actualPnpm}`);
}
