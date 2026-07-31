import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import {
  StorageError,
  type ImmutableStoredObject,
  type MediaObjectStorage,
  type ObjectStorage,
  type StoredObjectMetadata,
  type UploadSession,
  type UploadSessionRequest,
} from "./types.js";

type S3StorageOptions = Readonly<{
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  clock?: () => Date;
  fetch?: typeof globalThis.fetch;
  keyFactory?: () => string;
  maximumUploadBytes?: number;
  allowedContentTypes?: readonly string[];
}>;

const DEFAULT_MAXIMUM_UPLOAD_BYTES = 20 * 1024 * 1024;
const DEFAULT_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function signingKey(secret: string, date: string, region: string): Buffer {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function amzDate(value: Date): string {
  return value.toISOString().replace(/[:-]|\.\d{3}/gu, "");
}

function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalPath(bucket: string, objectKey: string): string {
  return `/${[bucket, ...objectKey.split("/")].map(encode).join("/")}`;
}

function canonicalQuery(parameters: Readonly<Record<string, string>>): string {
  return Object.entries(parameters)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .join("&");
}

function normalizedHeaderValue(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function isValidChecksum(value: string): boolean {
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.length === 32
      && timingSafeEqual(decoded, Buffer.from(decoded.toString("base64"), "base64"))
      && decoded.toString("base64") === value;
  } catch {
    return false;
  }
}

export class S3ObjectStorage implements ObjectStorage, MediaObjectStorage {
  readonly #endpoint: URL;
  readonly #region: string;
  readonly #bucket: string;
  readonly #accessKey: string;
  readonly #secretKey: string;
  readonly #clock: () => Date;
  readonly #fetch: typeof globalThis.fetch;
  readonly #keyFactory: () => string;
  readonly #maximumUploadBytes: number;
  readonly #allowedContentTypes: ReadonlySet<string>;

  constructor(options: S3StorageOptions) {
    this.#endpoint = new URL(options.endpoint);
    if (this.#endpoint.pathname !== "/") {
      throw new TypeError("S3 endpoint must not contain a path.");
    }
    this.#region = options.region;
    this.#bucket = options.bucket;
    this.#accessKey = options.accessKey;
    this.#secretKey = options.secretKey;
    this.#clock = options.clock ?? (() => new Date());
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#keyFactory = options.keyFactory ?? randomUUID;
    this.#maximumUploadBytes =
      options.maximumUploadBytes ?? DEFAULT_MAXIMUM_UPLOAD_BYTES;
    this.#allowedContentTypes = new Set(
      options.allowedContentTypes ?? DEFAULT_CONTENT_TYPES,
    );
  }

  createUploadSession(request: UploadSessionRequest): UploadSession {
    const ownerId = request.ownerId.trim();
    if (!ownerId) {
      throw new StorageError("OWNER_REQUIRED", "An owner is required.");
    }
    if (!this.#allowedContentTypes.has(request.contentType)) {
      throw new StorageError(
        "CONTENT_TYPE_NOT_ALLOWED",
        "The requested content type is not allowed.",
        415,
      );
    }
    if (
      !Number.isSafeInteger(request.contentLength)
      || request.contentLength < 1
      || request.contentLength > this.#maximumUploadBytes
    ) {
      throw new StorageError(
        "CONTENT_LENGTH_NOT_ALLOWED",
        "The requested content length is outside the allowed range.",
        413,
      );
    }
    if (!isValidChecksum(request.checksumSha256)) {
      throw new StorageError(
        "CHECKSUM_INVALID",
        "checksumSha256 must be a canonical base64-encoded SHA-256 digest.",
      );
    }
    const expiresInSeconds = request.expiresInSeconds ?? 300;
    if (
      !Number.isSafeInteger(expiresInSeconds)
      || expiresInSeconds < 1
      || expiresInSeconds > 900
    ) {
      throw new StorageError(
        "EXPIRY_INVALID",
        "Upload expiry must be between 1 and 900 seconds.",
      );
    }

    const ownerSegment = sha256(ownerId).slice(0, 32);
    const objectKey = `attachments/${ownerSegment}/${this.#keyFactory()}`;
    const now = this.#clock();
    const headers = {
      "content-length": String(request.contentLength),
      "content-type": request.contentType,
      "if-none-match": "*",
      "x-amz-checksum-sha256": request.checksumSha256,
      "x-amz-meta-sha256": request.checksumSha256,
    };
    return {
      objectKey,
      uploadUrl: this.#presign("PUT", objectKey, headers, expiresInSeconds, now),
      headers,
      expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
    };
  }

  async inspectObject(objectKey: string): Promise<StoredObjectMetadata> {
    if (!/^attachments\/[a-f0-9]{32}\/[A-Za-z0-9-]+$/u.test(objectKey)) {
      throw new StorageError("OBJECT_KEY_INVALID", "Object key is invalid.");
    }
    const response = await this.#fetch(
      this.#presign("HEAD", objectKey, {}, 60, this.#clock()),
      { method: "HEAD" },
    );
    if (response.status === 404) {
      throw new StorageError("OBJECT_NOT_FOUND", "Uploaded object was not found.", 404);
    }
    if (!response.ok) {
      throw new StorageError(
        "OBJECT_INSPECTION_FAILED",
        `Object inspection failed with status ${response.status}.`,
        502,
      );
    }
    const objectVersion = response.headers.get("x-amz-version-id");
    const checksumSha256 = response.headers.get("x-amz-meta-sha256");
    const contentType = response.headers.get("content-type");
    const contentLength = Number(response.headers.get("content-length"));
    const etag = response.headers.get("etag");
    if (
      !objectVersion
      || !checksumSha256
      || !contentType
      || !Number.isSafeInteger(contentLength)
      || contentLength < 0
      || !etag
    ) {
      throw new StorageError(
        "OBJECT_METADATA_INCOMPLETE",
        "Uploaded object is missing immutable version or checksum metadata.",
        502,
      );
    }
    return {
      objectKey,
      objectVersion,
      checksumSha256,
      contentType,
      contentLength,
      etag,
    };
  }

  async readQuarantine(
    objectKey: string,
    objectVersion: string,
  ): Promise<Buffer> {
    if (!/^attachments\/[a-f0-9]{32}\/[A-Za-z0-9-]+$/u.test(objectKey)) {
      throw new StorageError("OBJECT_KEY_INVALID", "Object key is invalid.");
    }
    if (!objectVersion.trim()) {
      throw new StorageError(
        "OBJECT_VERSION_REQUIRED",
        "An immutable object version is required.",
      );
    }
    const response = await this.#fetch(
      this.#presign(
        "GET",
        objectKey,
        {},
        60,
        this.#clock(),
        { versionId: objectVersion },
      ),
      { method: "GET" },
    );
    if (!response.ok) {
      throw new StorageError(
        "QUARANTINE_READ_FAILED",
        `Immutable quarantine read failed with status ${response.status}.`,
        response.status === 404 ? 404 : 502,
      );
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isSafeInteger(declaredLength)
      && declaredLength > this.#maximumUploadBytes
    ) {
      throw new StorageError(
        "CONTENT_LENGTH_NOT_ALLOWED",
        "The quarantine object exceeds the safe processing limit.",
        413,
      );
    }
    const value = Buffer.from(new Uint8Array(await response.arrayBuffer()));
    if (value.byteLength > this.#maximumUploadBytes) {
      throw new StorageError(
        "CONTENT_LENGTH_NOT_ALLOWED",
        "The quarantine object exceeds the safe processing limit.",
        413,
      );
    }
    return value;
  }

  async putImmutable(
    objectKey: string,
    value: Buffer,
    contentType: string,
  ): Promise<ImmutableStoredObject> {
    if (!/^derived\/[0-9a-f-]{36}\/[A-Za-z0-9-]+$/u.test(objectKey)) {
      throw new StorageError(
        "DERIVATIVE_KEY_INVALID",
        "Derivative object key is invalid.",
      );
    }
    if (value.byteLength < 1 || value.byteLength > this.#maximumUploadBytes) {
      throw new StorageError(
        "CONTENT_LENGTH_NOT_ALLOWED",
        "Derivative length is outside the allowed range.",
        413,
      );
    }
    const digest = createHash("sha256").update(value).digest("base64");
    const headers = {
      "content-length": String(value.byteLength),
      "content-type": contentType,
      "if-none-match": "*",
      "x-amz-checksum-sha256": digest,
      "x-amz-meta-sha256": digest,
    };
    const response = await this.#fetch(
      this.#presign("PUT", objectKey, headers, 60, this.#clock()),
      { method: "PUT", headers, body: Uint8Array.from(value) },
    );
    if (response.status === 409 || response.status === 412) {
      throw new StorageError(
        "IMMUTABLE_OBJECT_EXISTS",
        "The derivative object key already exists.",
        409,
      );
    }
    if (!response.ok) {
      throw new StorageError(
        "DERIVATIVE_WRITE_FAILED",
        `Derivative write failed with status ${response.status}.`,
        502,
      );
    }
    const version = response.headers.get("x-amz-version-id");
    if (!version) {
      throw new StorageError(
        "OBJECT_VERSION_REQUIRED",
        "Derivative storage did not return an immutable version.",
        502,
      );
    }
    return {
      key: objectKey,
      version,
      checksumSha256: digest,
      contentType,
      contentLength: value.byteLength,
    };
  }

  #presign(
    method: "PUT" | "HEAD" | "GET",
    objectKey: string,
    headers: Readonly<Record<string, string>>,
    expiresInSeconds: number,
    now: Date,
    additionalQuery: Readonly<Record<string, string>> = {},
  ): string {
    const timestamp = amzDate(now);
    const shortDate = timestamp.slice(0, 8);
    const scope = `${shortDate}/${this.#region}/s3/aws4_request`;
    const host = this.#endpoint.host;
    const allHeaders: Readonly<Record<string, string>> = { host, ...headers };
    const signedHeaders = Object.keys(allHeaders).sort();
    const canonicalHeaders = signedHeaders
      .map((name) => `${name}:${normalizedHeaderValue(allHeaders[name]!)}`)
      .join("\n");
    const parameters = {
      ...additionalQuery,
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${this.#accessKey}/${scope}`,
      "X-Amz-Date": timestamp,
      "X-Amz-Expires": String(expiresInSeconds),
      "X-Amz-SignedHeaders": signedHeaders.join(";"),
    };
    const query = canonicalQuery(parameters);
    const request = [
      method,
      canonicalPath(this.#bucket, objectKey),
      query,
      `${canonicalHeaders}\n`,
      signedHeaders.join(";"),
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      timestamp,
      scope,
      sha256(request),
    ].join("\n");
    const signature = createHmac(
      "sha256",
      signingKey(this.#secretKey, shortDate, this.#region),
    )
      .update(stringToSign)
      .digest("hex");
    const url = new URL(
      canonicalPath(this.#bucket, objectKey),
      this.#endpoint,
    );
    url.search = `${query}&X-Amz-Signature=${signature}`;
    return url.toString();
  }
}
