import { createHash } from "node:crypto";

export const IMPORT_COMMIT_CHUNK_SIZE = 50;

export const IMPORT_COMMITABLE_ROW_STATUSES = [
  "new",
  "update",
  "duplicate",
  "ready",
] as const;

export type ImportCommitableRowStatus =
  (typeof IMPORT_COMMITABLE_ROW_STATUSES)[number];

export const IMPORT_COMMIT_SCOPE_DEFAULT = "default";

export function importOverrideScope(decisionId: string): string {
  if (!/^[0-9a-f-]{36}$/iu.test(decisionId)) {
    throw new TypeError("Import override decision id must be a UUID");
  }
  return `override:${decisionId}`;
}

export function importFingerprintClaimScope(decisionScope: string): string {
  return decisionScope === IMPORT_COMMIT_SCOPE_DEFAULT
    ? "trip"
    : decisionScope;
}

export function importRowReplayKey(input: {
  sourceSha256: string;
  importerVersion: string;
  mappingHash: string;
  sourceRowKey: string;
  decisionScope?: string;
}): string {
  return createHash("sha256")
    .update([
      input.sourceSha256,
      input.importerVersion,
      input.mappingHash,
      input.sourceRowKey,
      input.decisionScope ?? IMPORT_COMMIT_SCOPE_DEFAULT,
    ].join("\u0000"))
    .digest("hex");
}

export class ImportCommitStateError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = "ImportCommitStateError";
    this.code = code;
    this.status = status;
  }
}

export function assertImportCommitCanStart(status: string): void {
  if (["confirmation_required", "ready_to_import", "importing"].includes(status)) return;
  if (status === "processing_media") {
    throw new ImportCommitStateError(
      "IMPORT_COMMIT_ALREADY_FINISHED",
      "Import text rows have already been committed; media processing is still running.",
    );
  }
  if (status === "completed" || status === "completed_with_warnings") {
    throw new ImportCommitStateError(
      "IMPORT_COMMIT_ALREADY_FINISHED",
      "The import job has already finished.",
    );
  }
  throw new ImportCommitStateError(
    "IMPORT_COMMIT_NOT_READY",
    "The import job must be confirmed before it can be committed.",
  );
}

export function assertImportCommitCancelable(status: string): void {
  if ([
    "confirmation_required",
    "ready_to_import",
    "importing",
    "processing_media",
    "cancelling",
    "cancelled",
  ].includes(status)) return;
  throw new ImportCommitStateError(
    "IMPORT_CANCEL_NOT_ALLOWED",
    "The import job is not in a cancellable state.",
  );
}
