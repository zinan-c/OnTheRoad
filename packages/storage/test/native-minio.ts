import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type NativeMinio = Readonly<{
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  stop: () => Promise<void>;
}>;

async function unusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a local MinIO port."));
        return;
      }
      const { port } = address;
      server.close((error: unknown) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitUntilReady(endpoint: string, process: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.exitCode !== null) {
      throw new Error(`Native MinIO exited before readiness (${process.exitCode}).`);
    }
    try {
      const response = await fetch(`${endpoint}/minio/health/ready`);
      if (response.ok) return;
    } catch {
      // The native server has not bound the port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for native MinIO.");
}

function runMc(
  configDirectory: string,
  environment: NodeJS.ProcessEnv,
  args: readonly string[],
): void {
  const result = spawnSync("mc", args, {
    env: { ...environment, MC_CONFIG_DIR: configDirectory },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`mc ${args[0]} failed: ${result.stderr || result.stdout}`);
  }
}

export async function startNativeMinio(): Promise<NativeMinio> {
  const root = await mkdtemp(join(tmpdir(), "otr-d01-minio-"));
  const dataDirectory = join(root, "data");
  const configDirectory = join(root, "mc");
  await mkdir(dataDirectory);
  await mkdir(configDirectory);
  const apiPort = await unusedPort();
  const consolePort = await unusedPort();
  const endpoint = `http://127.0.0.1:${apiPort}`;
  const accessKey = "otr_d01_native";
  const secretKey = "otr_d01_native_secret_32_bytes_min";
  const environment = {
    ...process.env,
    MINIO_ROOT_USER: accessKey,
    MINIO_ROOT_PASSWORD: secretKey,
  };
  const server = spawn(
    "minio",
    [
      "server",
      "--address",
      `127.0.0.1:${apiPort}`,
      "--console-address",
      `127.0.0.1:${consolePort}`,
      dataDirectory,
    ],
    {
      env: environment,
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
  try {
    await waitUntilReady(endpoint, server);
    runMc(configDirectory, environment, [
      "alias",
      "set",
      "otr-d01",
      endpoint,
      accessKey,
      secretKey,
    ]);
    runMc(configDirectory, environment, [
      "mb",
      "--ignore-existing",
      "otr-d01/attachments",
    ]);
    runMc(configDirectory, environment, [
      "version",
      "enable",
      "otr-d01/attachments",
    ]);
  } catch (error) {
    server.kill("SIGTERM");
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  return {
    endpoint,
    bucket: "attachments",
    accessKey,
    secretKey,
    stop: async () => {
      if (server.exitCode === null) {
        server.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          server.once("exit", () => resolve());
          setTimeout(() => {
            if (server.exitCode === null) server.kill("SIGKILL");
            resolve();
          }, 2_000);
        });
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}
