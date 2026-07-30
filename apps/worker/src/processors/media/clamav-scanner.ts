import { createConnection } from "node:net";

import {
  MediaPipelineError,
  type MalwareScanner,
} from "./media-pipeline.js";

type ClamAvScannerOptions = Readonly<{
  host: string;
  port?: number;
  timeoutMs?: number;
  chunkBytes?: number;
}>;

function frame(value: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(value.byteLength, 0);
  return Buffer.concat([header, value]);
}

export class ClamAvTcpScanner implements MalwareScanner {
  readonly #host: string;
  readonly #port: number;
  readonly #timeoutMs: number;
  readonly #chunkBytes: number;

  constructor(options: ClamAvScannerOptions) {
    if (!options.host.trim()) {
      throw new TypeError("ClamAV host is required.");
    }
    this.#host = options.host;
    this.#port = options.port ?? 3310;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#chunkBytes = options.chunkBytes ?? 64 * 1024;
  }

  scan(value: Buffer): Promise<
    Readonly<{ clean: true }>
    | Readonly<{ clean: false; signature: string }>
  > {
    return new Promise((resolve, reject) => {
      const socket = createConnection({
        host: this.#host,
        port: this.#port,
      });
      const response: Buffer[] = [];
      const fail = (message: string): void => {
        socket.destroy();
        reject(new MediaPipelineError(
          "MEDIA_SCANNER_UNAVAILABLE",
          message,
          true,
        ));
      };
      socket.setTimeout(this.#timeoutMs);
      socket.once("timeout", () => fail("ClamAV scan timed out."));
      socket.once("error", () => fail("ClamAV connection failed."));
      socket.on("data", (chunk: Buffer) => response.push(Buffer.from(chunk)));
      socket.once("connect", () => {
        socket.write("zINSTREAM\0");
        for (let offset = 0; offset < value.byteLength; offset += this.#chunkBytes) {
          socket.write(frame(value.subarray(offset, offset + this.#chunkBytes)));
        }
        socket.end(Buffer.alloc(4));
      });
      socket.once("end", () => {
        const result = Buffer.concat(response).toString("utf8").replace(/\0+$/u, "");
        if (result.endsWith(" OK")) {
          resolve({ clean: true });
          return;
        }
        const found = /stream: (.+) FOUND$/u.exec(result);
        if (found?.[1]) {
          resolve({ clean: false, signature: found[1] });
          return;
        }
        fail("ClamAV returned an invalid or error response.");
      });
    });
  }
}
