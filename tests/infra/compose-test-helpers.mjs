import { spawnSync } from "node:child_process";

export const repoRoot = new URL("../../", import.meta.url);
export const integrationEnabled = process.env.RUN_COMPOSE_INTEGRATION === "1";

export function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
    ...options,
  });
}

export function combinedOutput(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
