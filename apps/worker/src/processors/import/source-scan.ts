import { createHash } from "node:crypto";

import { ImportInspectError, type ImportSourceAttachment } from "./inspect.js";

type WorkbookScanRepository = {
  getAttachment: (
    id: string,
  ) => ImportSourceAttachment | Promise<ImportSourceAttachment>;
  recordCleanScan: (
    id: string,
    evidence: {
      scanner: string;
      objectVersion: string;
      checksumSha256: string;
      scannedAt: string;
      expectedVersion: number;
    },
  ) => ImportSourceAttachment | Promise<ImportSourceAttachment>;
  markAttachmentFailed: (
    id: string,
    errorCode: string,
  ) => ImportSourceAttachment | Promise<ImportSourceAttachment>;
};

type WorkbookSourceScannerOptions = {
  repository: WorkbookScanRepository;
  storage: {
    readImmutable: (objectKey: string, objectVersion: string) => Promise<Buffer>;
  };
  scanner: {
    name: string;
    scan: (body: Buffer) => Promise<
      { clean: true } | { clean: false; signature?: string }
    >;
  };
  now?: () => Date;
};

export class WorkbookSourceScanProcessor {
  readonly #repository: WorkbookScanRepository;
  readonly #storage: WorkbookSourceScannerOptions["storage"];
  readonly #scanner: WorkbookSourceScannerOptions["scanner"];
  readonly #now: () => Date;

  constructor(options: WorkbookSourceScannerOptions) {
    this.#repository = options.repository;
    this.#storage = options.storage;
    this.#scanner = options.scanner;
    this.#now = options.now ?? (() => new Date());
  }

  async process(attachmentId: string): Promise<ImportSourceAttachment> {
    const attachment = await this.#repository.getAttachment(attachmentId);
    if (
      attachment.status !== "uploaded"
      || !attachment.objectKey
      || !attachment.objectVersion
      || !attachment.checksumSha256
    ) {
      throw new ImportInspectError(
        "IMPORT_SOURCE_NOT_UPLOADED",
        "Workbook scan requires an immutable uploaded source.",
      );
    }
    const body = await this.#storage.readImmutable(
      attachment.objectKey,
      attachment.objectVersion,
    );
    const bodyChecksum = createHash("sha256").update(body).digest("base64");
    if (
      bodyChecksum !== attachment.checksumSha256
      || (
        attachment.contentLength !== undefined
        && body.byteLength !== attachment.contentLength
      )
    ) {
      await this.#repository.markAttachmentFailed(
        attachment.id,
        "IMPORT_SOURCE_CONTENT_CHANGED",
      );
      throw new ImportInspectError(
        "IMPORT_SOURCE_CONTENT_CHANGED",
        "Workbook source does not match its immutable upload metadata.",
      );
    }
    let result;
    try {
      result = await this.#scanner.scan(body);
    } catch (error) {
      await this.#repository.markAttachmentFailed(
        attachment.id,
        "WORKBOOK_SCANNER_UNAVAILABLE",
      );
      throw new ImportInspectError(
        "WORKBOOK_SCANNER_UNAVAILABLE",
        "Workbook malware scanner is unavailable; source remains fail-closed.",
        true,
        error,
      );
    }
    if (!result.clean) {
      await this.#repository.markAttachmentFailed(
        attachment.id,
        "WORKBOOK_MALWARE_DETECTED",
      );
      throw new ImportInspectError(
        "WORKBOOK_MALWARE_DETECTED",
        "Workbook malware scan rejected the source.",
      );
    }
    return await this.#repository.recordCleanScan(attachment.id, {
      scanner: this.#scanner.name,
      objectVersion: attachment.objectVersion,
      checksumSha256: attachment.checksumSha256,
      scannedAt: this.#now().toISOString(),
      expectedVersion: attachment.version,
    });
  }
}
