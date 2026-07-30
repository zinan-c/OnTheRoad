import { createHash, randomUUID } from "node:crypto";

export type UploadedAttachment = Readonly<{
  id: string;
  ownerId: string;
  objectKey: string;
  objectVersion: string;
  checksumSha256: string;
  contentType: string;
  contentLength: number;
  status: "uploaded";
  version: number;
}>;

type ProcessingAttachment = Omit<UploadedAttachment, "status"> & Readonly<{
  status: "processing";
}>;

type ReadyAttachment = Omit<ProcessingAttachment, "status"> & Readonly<{
  status: "ready";
  width: number;
  height: number;
  thumbnailKey: string;
  thumbnailVersion: string;
  thumbnailChecksumSha256: string;
  thumbnailContentType: string;
  thumbnailContentLength: number;
}>;

type FailedAttachment = Omit<ProcessingAttachment, "status"> & Readonly<{
  status: "failed";
  errorCode: string;
}>;

type MediaAttachment =
  | UploadedAttachment
  | ProcessingAttachment
  | ReadyAttachment
  | FailedAttachment;

export class MediaPipelineError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    retryable = false,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "MediaPipelineError";
    this.code = code;
    this.retryable = retryable;
  }
}

type ScanResult =
  | Readonly<{ clean: true }>
  | Readonly<{ clean: false; signature: string }>;

export interface MalwareScanner {
  scan(value: Buffer): Promise<ScanResult>;
}

export interface ImageProcessor {
  process(value: Buffer): Promise<Readonly<{
    detectedContentType: string;
    width: number;
    height: number;
    thumbnail: Buffer;
    thumbnailContentType: string;
  }>>;
}

export interface MediaRepository {
  claim(id: string): Promise<ProcessingAttachment> | ProcessingAttachment;
  markReady(
    id: string,
    expectedVersion: number,
    metadata: Omit<
      ReadyAttachment,
      keyof ProcessingAttachment | "status" | "version"
    >,
  ): Promise<ReadyAttachment> | ReadyAttachment;
  markFailed(
    id: string,
    expectedVersion: number,
    errorCode: string,
  ): Promise<FailedAttachment> | FailedAttachment;
}

type ImmutableObject = Readonly<{
  key: string;
  version: string;
  checksumSha256: string;
  contentType: string;
  contentLength: number;
}>;

export interface MediaStorage {
  readQuarantine(objectKey: string, objectVersion: string): Promise<Buffer>;
  putImmutable(
    objectKey: string,
    value: Buffer,
    contentType: string,
  ): Promise<ImmutableObject>;
}

type MediaPipelineOptions = Readonly<{
  repository: MediaRepository;
  storage: MediaStorage;
  scanner: MalwareScanner;
  imageProcessor: ImageProcessor;
  keyFactory?: () => string;
  maximumBytes?: number;
  maximumDimension?: number;
  maximumPixels?: number;
}>;

const DEFAULT_MAXIMUM_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAXIMUM_DIMENSION = 32_768;
const DEFAULT_MAXIMUM_PIXELS = 40_000_000;

function checksum(value: Buffer): string {
  return createHash("sha256").update(value).digest("base64");
}

export function detectImageContentType(value: Buffer): string | undefined {
  if (
    value.length >= 8
    && value.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return "image/png";
  }
  if (value.length >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    value.length >= 12
    && value.subarray(0, 4).toString("ascii") === "RIFF"
    && value.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

export class MediaPipeline {
  readonly #repository: MediaRepository;
  readonly #storage: MediaStorage;
  readonly #scanner: MalwareScanner;
  readonly #imageProcessor: ImageProcessor;
  readonly #keyFactory: () => string;
  readonly #maximumBytes: number;
  readonly #maximumDimension: number;
  readonly #maximumPixels: number;

  constructor(options: MediaPipelineOptions) {
    this.#repository = options.repository;
    this.#storage = options.storage;
    this.#scanner = options.scanner;
    this.#imageProcessor = options.imageProcessor;
    this.#keyFactory = options.keyFactory ?? randomUUID;
    this.#maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;
    this.#maximumDimension =
      options.maximumDimension ?? DEFAULT_MAXIMUM_DIMENSION;
    this.#maximumPixels = options.maximumPixels ?? DEFAULT_MAXIMUM_PIXELS;
  }

  async process(attachmentId: string): Promise<ReadyAttachment> {
    const attachment = await this.#repository.claim(attachmentId);
    try {
      const body = await this.#storage.readQuarantine(
        attachment.objectKey,
        attachment.objectVersion,
      );
      this.#validateUpload(attachment, body);
      let scan: ScanResult;
      try {
        scan = await this.#scanner.scan(body);
      } catch {
        throw new MediaPipelineError(
          "MEDIA_SCANNER_UNAVAILABLE",
          "The malware scanner is unavailable.",
          true,
        );
      }
      if (!scan.clean) {
        throw new MediaPipelineError(
          "MEDIA_MALWARE_DETECTED",
          `The upload was rejected by the malware scanner (${scan.signature}).`,
        );
      }

      let processed: Awaited<ReturnType<ImageProcessor["process"]>>;
      try {
        processed = await this.#imageProcessor.process(body);
      } catch {
        throw new MediaPipelineError(
          "MEDIA_IMAGE_DECODE_FAILED",
          "The image could not be decoded safely.",
        );
      }
      if (processed.detectedContentType !== attachment.contentType) {
        throw new MediaPipelineError(
          "MEDIA_DECODED_TYPE_MISMATCH",
          "The decoded image type does not match the upload metadata.",
        );
      }
      if (
        !Number.isSafeInteger(processed.width)
        || !Number.isSafeInteger(processed.height)
        || processed.width < 1
        || processed.height < 1
        || processed.width > this.#maximumDimension
        || processed.height > this.#maximumDimension
        || processed.width * processed.height > this.#maximumPixels
      ) {
        throw new MediaPipelineError(
          "MEDIA_DIMENSIONS_EXCEEDED",
          "The decoded image dimensions exceed the safe limit.",
        );
      }

      const thumbnail = await this.#storage.putImmutable(
        `derived/${attachment.id}/${this.#keyFactory()}`,
        processed.thumbnail,
        processed.thumbnailContentType,
      );
      return await this.#repository.markReady(
        attachment.id,
        attachment.version,
        {
          width: processed.width,
          height: processed.height,
          thumbnailKey: thumbnail.key,
          thumbnailVersion: thumbnail.version,
          thumbnailChecksumSha256: thumbnail.checksumSha256,
          thumbnailContentType: thumbnail.contentType,
          thumbnailContentLength: thumbnail.contentLength,
        },
      );
    } catch (error) {
      const failure = error instanceof MediaPipelineError
        ? error
        : new MediaPipelineError(
          "MEDIA_PROCESSING_FAILED",
          "Media processing failed safely.",
          true,
          error,
        );
      await this.#repository.markFailed(
        attachment.id,
        attachment.version,
        failure.code,
      );
      throw failure;
    }
  }

  #validateUpload(attachment: ProcessingAttachment, body: Buffer): void {
    if (
      body.byteLength < 1
      || body.byteLength > this.#maximumBytes
      || body.byteLength !== attachment.contentLength
    ) {
      throw new MediaPipelineError(
        "MEDIA_SIZE_MISMATCH",
        "The immutable upload size does not match its metadata.",
      );
    }
    if (checksum(body) !== attachment.checksumSha256) {
      throw new MediaPipelineError(
        "MEDIA_CHECKSUM_MISMATCH",
        "The immutable upload checksum does not match its metadata.",
      );
    }
    if (detectImageContentType(body) !== attachment.contentType) {
      throw new MediaPipelineError(
        "MEDIA_MAGIC_MISMATCH",
        "The upload magic bytes do not match its declared image type.",
      );
    }
  }
}

export class InMemoryMediaRepository implements MediaRepository {
  readonly #attachments = new Map<string, MediaAttachment>();
  readonly #history = new Map<string, MediaAttachment[]>();

  constructor(attachments: readonly UploadedAttachment[] = []) {
    for (const attachment of attachments) {
      this.#attachments.set(attachment.id, attachment);
      this.#history.set(attachment.id, [attachment]);
    }
  }

  claim(id: string): ProcessingAttachment {
    const attachment = this.#attachments.get(id);
    if (!attachment || attachment.status !== "uploaded") {
      throw new MediaPipelineError(
        "MEDIA_NOT_CLAIMABLE",
        "The attachment is not awaiting media processing.",
      );
    }
    const processing: ProcessingAttachment = {
      ...attachment,
      status: "processing",
      version: attachment.version + 1,
    };
    this.#record(processing);
    return processing;
  }

  markReady(
    id: string,
    expectedVersion: number,
    metadata: Omit<
      ReadyAttachment,
      keyof ProcessingAttachment | "status" | "version"
    >,
  ): ReadyAttachment {
    const attachment = this.#expectProcessing(id, expectedVersion);
    const ready: ReadyAttachment = {
      ...attachment,
      ...metadata,
      status: "ready",
      version: attachment.version + 1,
    };
    this.#record(ready);
    return ready;
  }

  markFailed(
    id: string,
    expectedVersion: number,
    errorCode: string,
  ): FailedAttachment {
    const attachment = this.#expectProcessing(id, expectedVersion);
    const failed: FailedAttachment = {
      ...attachment,
      status: "failed",
      errorCode,
      version: attachment.version + 1,
    };
    this.#record(failed);
    return failed;
  }

  get(id: string): MediaAttachment | undefined {
    return this.#attachments.get(id);
  }

  history(id: string): readonly MediaAttachment[] {
    return this.#history.get(id) ?? [];
  }

  requeueStale(id: string, expectedVersion: number): UploadedAttachment {
    const attachment = this.#attachments.get(id);
    if (
      !attachment
      || attachment.status !== "processing"
      || attachment.version !== expectedVersion
    ) {
      throw new MediaPipelineError(
        "MEDIA_VERSION_CONFLICT",
        "The stale processing claim no longer owns the attachment.",
        true,
      );
    }
    const uploaded: UploadedAttachment = {
      id: attachment.id,
      ownerId: attachment.ownerId,
      objectKey: attachment.objectKey,
      objectVersion: attachment.objectVersion,
      checksumSha256: attachment.checksumSha256,
      contentType: attachment.contentType,
      contentLength: attachment.contentLength,
      status: "uploaded",
      version: attachment.version + 1,
    };
    this.#record(uploaded);
    return uploaded;
  }

  #expectProcessing(id: string, expectedVersion: number): ProcessingAttachment {
    const attachment = this.#attachments.get(id);
    if (
      !attachment
      || attachment.status !== "processing"
      || attachment.version !== expectedVersion
    ) {
      throw new MediaPipelineError(
        "MEDIA_VERSION_CONFLICT",
        "The attachment changed while it was processing.",
        true,
      );
    }
    return attachment;
  }

  #record(attachment: MediaAttachment): void {
    this.#attachments.set(attachment.id, attachment);
    this.#history.set(attachment.id, [
      ...(this.#history.get(attachment.id) ?? []),
      attachment,
    ]);
  }
}

export class InMemoryMediaStorage implements MediaStorage {
  readonly #quarantine = new Map<string, Buffer>();
  readonly #public = new Map<string, ImmutableObject>();

  seedQuarantine(objectKey: string, objectVersion: string, value: Buffer): void {
    this.#quarantine.set(`${objectKey}@${objectVersion}`, Buffer.from(value));
  }

  async readQuarantine(
    objectKey: string,
    objectVersion: string,
  ): Promise<Buffer> {
    const value = this.#quarantine.get(`${objectKey}@${objectVersion}`);
    if (!value) {
      throw new MediaPipelineError(
        "MEDIA_OBJECT_NOT_FOUND",
        "The immutable upload object was not found.",
      );
    }
    return Buffer.from(value);
  }

  async putImmutable(
    objectKey: string,
    value: Buffer,
    contentType: string,
  ): Promise<ImmutableObject> {
    if (this.#public.has(objectKey)) {
      throw new MediaPipelineError(
        "MEDIA_IMMUTABLE_OBJECT_EXISTS",
        "The derivative object key already exists.",
      );
    }
    const metadata = {
      key: objectKey,
      version: randomUUID(),
      checksumSha256: checksum(value),
      contentType,
      contentLength: value.byteLength,
    };
    this.#public.set(objectKey, metadata);
    return metadata;
  }

  publicKeys(): string[] {
    return [...this.#public.keys()].sort();
  }

  canReadPublicly(objectKey: string): boolean {
    return this.#public.has(objectKey);
  }

  async listDerivativeKeys(attachmentId: string): Promise<readonly string[]> {
    const prefix = `derived/${attachmentId}/`;
    return [...this.#public.keys()].filter((key) => key.startsWith(prefix)).sort();
  }

  async deleteDerivative(objectKey: string): Promise<void> {
    this.#public.delete(objectKey);
  }
}
