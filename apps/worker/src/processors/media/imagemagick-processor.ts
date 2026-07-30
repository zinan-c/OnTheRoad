import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ImageProcessor } from "./media-pipeline.js";

const execFileAsync = promisify(execFile);

const TYPES: Readonly<Record<string, string>> = {
  JPEG: "image/jpeg",
  PNG: "image/png",
  WEBP: "image/webp",
};

export class ImageMagickProcessor implements ImageProcessor {
  readonly #binary: string;
  readonly #maximumInputBytes: number;
  readonly #timeoutMs: number;

  constructor(options: Readonly<{
    binary?: string;
    maximumInputBytes?: number;
    timeoutMs?: number;
  }> = {}) {
    this.#binary = options.binary ?? "magick";
    this.#maximumInputBytes = options.maximumInputBytes ?? 20 * 1024 * 1024;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
  }

  async process(value: Buffer): Promise<Readonly<{
    detectedContentType: string;
    width: number;
    height: number;
    thumbnail: Buffer;
    thumbnailContentType: string;
  }>> {
    if (value.byteLength < 1 || value.byteLength > this.#maximumInputBytes) {
      throw new Error("Image input is outside the allowed size.");
    }
    const directory = await mkdtemp(join(tmpdir(), "otr-media-"));
    const input = join(directory, "source");
    const thumbnailPath = join(directory, "thumbnail.png");
    try {
      await writeFile(input, value, { flag: "wx", mode: 0o600 });
      const { stdout } = await execFileAsync(
        this.#binary,
        ["identify", "-ping", "-format", "%m %w %h", input],
        {
          encoding: "utf8",
          timeout: this.#timeoutMs,
          maxBuffer: 64 * 1024,
        },
      );
      const [format, widthValue, heightValue] = stdout.trim().split(/\s+/u);
      const detectedContentType = format ? TYPES[format.toUpperCase()] : undefined;
      const width = Number(widthValue);
      const height = Number(heightValue);
      if (
        !detectedContentType
        || !Number.isSafeInteger(width)
        || !Number.isSafeInteger(height)
      ) {
        throw new Error("ImageMagick returned invalid image metadata.");
      }
      await execFileAsync(
        this.#binary,
        [
          input,
          "-auto-orient",
          "-strip",
          "-thumbnail",
          "512x512>",
          `PNG:${thumbnailPath}`,
        ],
        {
          timeout: this.#timeoutMs,
          maxBuffer: 256 * 1024,
        },
      );
      return {
        detectedContentType,
        width,
        height,
        thumbnail: await readFile(thumbnailPath),
        thumbnailContentType: "image/png",
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
