export type UploadSessionRequest = Readonly<{
  ownerId: string;
  contentType: string;
  contentLength: number;
  checksumSha256: string;
  expiresInSeconds?: number;
}>;

export type UploadSession = Readonly<{
  objectKey: string;
  uploadUrl: string;
  headers: Readonly<Record<string, string>>;
  expiresAt: string;
}>;

export type StoredObjectMetadata = Readonly<{
  objectKey: string;
  objectVersion: string;
  checksumSha256: string;
  contentType: string;
  contentLength: number;
  etag: string;
}>;

export interface ObjectStorage {
  createUploadSession(request: UploadSessionRequest): UploadSession;
  inspectObject(objectKey: string): Promise<StoredObjectMetadata>;
}

export class StorageError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.status = status;
  }
}
