import type {
  MediaStorage,
  UploadedAttachment,
} from "./media-pipeline.js";

type RecoverableRepository = Readonly<{
  requeueStale(
    id: string,
    expectedVersion: number,
  ): Promise<UploadedAttachment> | UploadedAttachment;
}>;

type RecoverableStorage = MediaStorage & Readonly<{
  listDerivativeKeys(attachmentId: string): Promise<readonly string[]>;
  deleteDerivative(objectKey: string): Promise<void>;
}>;

export class MediaRecoveryCoordinator {
  readonly #repository: RecoverableRepository;
  readonly #storage: RecoverableStorage;

  constructor(options: Readonly<{
    repository: RecoverableRepository;
    storage: RecoverableStorage;
  }>) {
    this.#repository = options.repository;
    this.#storage = options.storage;
  }

  async requeueStale(
    attachmentId: string,
    expectedVersion: number,
  ): Promise<UploadedAttachment> {
    const keys = await this.#storage.listDerivativeKeys(attachmentId);
    for (const key of keys) {
      await this.#storage.deleteDerivative(key);
    }
    return this.#repository.requeueStale(attachmentId, expectedVersion);
  }
}
