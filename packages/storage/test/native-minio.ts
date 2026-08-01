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

type NativeMinioOptions = Readonly<{
  minioBin?: string;
  mcBin?: string;
}>;

export function resolveNativeTestBinary(
  explicitValue: string | undefined,
  environmentValue: string | undefined,
  fallback: string,
): string {
  return explicitValue?.trim() || environmentValue?.trim() || fallback;
}

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
  let startupError: Error | undefined;
  const captureStartupError = (error: Error) => {
    startupError = error;
  };
  process.once("error", captureStartupError);
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (startupError) {
        throw new Error(`Native MinIO failed to start: ${startupError.message}`, {
          cause: startupError,
        });
      }
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
  } finally {
    process.off("error", captureStartupError);
  }
  throw new Error("Timed out waiting for native MinIO.");
}

async function waitForAlias(
  mcBin: string,
  configDirectory: string,
  environment: NodeJS.ProcessEnv,
  server: ChildProcess,
  args: readonly string[],
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Native MinIO exited during initialization (${server.exitCode}).`, {
        cause: lastError,
      });
    }
    try {
      runMc(mcBin, configDirectory, environment, args);
      return;
    } catch (error) {
      if (error instanceof Error && error.cause) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for native MinIO credential initialization.", {
    cause: lastError,
  });
}

function runMc(
  mcBin: string,
  configDirectory: string,
  environment: NodeJS.ProcessEnv,
  args: readonly string[],
): void {
  const result = spawnSync(mcBin, args, {
    env: { ...environment, MC_CONFIG_DIR: configDirectory },
    encoding: "utf8",
  });
  if (result.error) {
    throw new Error(`Native MC failed to start: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new Error(`mc ${args[0]} failed: ${result.stderr || result.stdout}`);
  }
}

export async function startNativeMinio(
  options: NativeMinioOptions = {},
): Promise<NativeMinio> {
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
  const minioBin = resolveNativeTestBinary(
    options.minioBin,
    process.env.MINIO_BIN,
    "minio",
  );
  const mcBin = resolveNativeTestBinary(options.mcBin, process.env.MC_BIN, "mc");
  const server = spawn(
    minioBin,
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
    await waitForAlias(mcBin, configDirectory, environment, server, [
      "alias",
      "set",
      "otr-d01",
      endpoint,
      accessKey,
      secretKey,
    ]);
    runMc(mcBin, configDirectory, environment, [
      "mb",
      "--ignore-existing",
      "otr-d01/attachments",
    ]);
    runMc(mcBin, configDirectory, environment, [
      "version",
      "enable",
      "otr-d01/attachments",
    ]);
  } catch (error) {
    if (server.pid && server.exitCode === null) server.kill("SIGTERM");
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
