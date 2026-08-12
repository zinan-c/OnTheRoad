export const IMPORT_JOB_STATUSES = [
  "uploaded",
  "parsing",
  "mapping_required",
  "validating",
  "geocoding",
  "confirmation_required",
  "ready_to_import",
  "importing",
  "processing_media",
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelling",
  "cancelled",
] as const;

export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export const IMPORT_ROW_STATUSES = [
  "pending",
  "new",
  "update",
  "duplicate",
  "error",
  "unresolved",
  "ready",
  "imported",
  "skipped",
] as const;

export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

export const IMPORT_COMMIT_ACTIONS = ["insert", "update", "skip"] as const;
export type ImportCommitAction = (typeof IMPORT_COMMIT_ACTIONS)[number];

export type ImportCommitDecision = Readonly<{
  id: string;
  importJobId: string;
  importRowId: string;
  actorId: string;
  reason: string;
  decisionType: "duplicate_insert";
  consumedAt: string | null;
}>;

export type ImportCommitResult = Readonly<{
  jobId: string;
  committedRows: number;
  insertedRows: number;
  updatedRows: number;
  skippedRows: number;
  mediaTaskIds: readonly string[];
}>;

export const IMPORT_MEDIA_TASK_STATUSES = [
  "awaiting_approval",
  "approved",
  "rejected",
  "queued",
  "fetching",
  "quarantined",
  "scanning",
  "processing",
  "retry_scheduled",
  "ready",
  "failed",
  "cancelling",
  "cancelled",
] as const;
export type ImportMediaTaskStatus = (typeof IMPORT_MEDIA_TASK_STATUSES)[number];

export type ImportMediaTask = Readonly<{
  id: string;
  tripId: string;
  importJobId: string;
  importRowId: string;
  sourceRowKey: string;
  itineraryItemId: string | null;
  attachmentId: string | null;
  urlOrdinal: number;
  sourceUrlSha256: string;
  status: ImportMediaTaskStatus;
  decisionBy: string | null;
  decidedAt: string | null;
  attemptCount: number;
  lifetimeAttemptCount: number;
  retryGeneration: number;
  nextAttemptAt: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}>;

export const GEOCODING_BATCH_STATUSES = [
  "queued",
  "running",
  "waiting_rate_limit",
  "cancelling",
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
] as const;

export type GeocodingBatchStatus = (typeof GEOCODING_BATCH_STATUSES)[number];

export const GEOCODING_BATCH_TERMINAL_STATUSES = [
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
] as const satisfies readonly GeocodingBatchStatus[];

export type GeocodingBatchProgress = Readonly<{
  totalUnits: number;
  queuedUnits: number;
  resolvingUnits: number;
  resolvedUnits: number;
  ambiguousUnits: number;
  failedUnits: number;
  cancelledUnits: number;
}>;

export type GeocodingBatch = GeocodingBatchProgress & Readonly<{
  id: string;
  tripId: string;
  importJobId: string;
  provider: string;
  mapProfile: "cn_primary" | "international_primary" | "hybrid";
  generation: number;
  status: GeocodingBatchStatus;
  cancelRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}>;

export type GeocodingRateLimitPolicy = Readonly<{
  capacity: number;
  refillPerSecond: number;
  maxConcurrency: number;
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
}>;

export type StagedLocationDecisionType =
  | "candidate"
  | "map_point"
  | "manual_coordinate"
  | "accept_text";

export type StagedLocationDecisionSource =
  | "provider_candidate"
  | "map_click"
  | "manual_coordinate"
  | "text_only";

export type StagedLocationDecision = Readonly<{
  id: string;
  tripId: string;
  importStagingId: string;
  actorId: string;
  decisionType: StagedLocationDecisionType;
  source: StagedLocationDecisionSource;
  decisionVersion: number;
  candidateTokenHash: string | null;
  payload: Readonly<Record<string, unknown>>;
  createdAt: string;
}>;

export function assertStagedLocationDecision(
  decision: StagedLocationDecision,
): void {
  if (!decision.actorId.trim()) throw new TypeError("staged location decision actor is required");
  if (!Number.isSafeInteger(decision.decisionVersion) || decision.decisionVersion < 1) {
    throw new TypeError("staged location decision version must be positive");
  }
  if (decision.payload === null || typeof decision.payload !== "object" || Array.isArray(decision.payload)) {
    throw new TypeError("staged location decision payload must be an object");
  }

  const expectedSource: Record<StagedLocationDecisionType, StagedLocationDecisionSource> = {
    candidate: "provider_candidate",
    map_point: "map_click",
    manual_coordinate: "manual_coordinate",
    accept_text: "text_only",
  };
  if (expectedSource[decision.decisionType] !== decision.source) {
    throw new TypeError("staged location decision source does not match its type");
  }

  if (decision.decisionType === "candidate") {
    if (!/^[a-f0-9]{64}$/u.test(decision.candidateTokenHash ?? "")) {
      throw new TypeError("candidate decisions require a token hash");
    }
  } else if (decision.candidateTokenHash !== null) {
    throw new TypeError("non-candidate decisions cannot contain a token hash");
  }
}

export function isTerminalGeocodingBatchStatus(
  status: GeocodingBatchStatus,
): status is (typeof GEOCODING_BATCH_TERMINAL_STATUSES)[number] {
  return (GEOCODING_BATCH_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function assertGeocodingBatchProgress(
  progress: GeocodingBatchProgress,
): void {
  const values = Object.values(progress);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError("Geocoding batch progress must use non-negative integers");
  }
  const accounted = progress.queuedUnits
    + progress.resolvingUnits
    + progress.resolvedUnits
    + progress.ambiguousUnits
    + progress.failedUnits
    + progress.cancelledUnits;
  if (accounted !== progress.totalUnits) {
    throw new TypeError("Geocoding batch progress must account for every unit exactly once");
  }
}

export function geocodingBatchProgressPercent(
  progress: GeocodingBatchProgress,
): number {
  assertGeocodingBatchProgress(progress);
  if (progress.totalUnits === 0) return 100;
  return Math.floor(
    ((progress.resolvedUnits + progress.ambiguousUnits + progress.failedUnits + progress.cancelledUnits)
      / progress.totalUnits) * 100,
  );
}

export const GEOCODING_BATCH_TRANSITIONS: Readonly<
  Record<GeocodingBatchStatus, readonly GeocodingBatchStatus[]>
> = {
  queued: ["running", "cancelling", "cancelled"],
  running: [
    "waiting_rate_limit",
    "cancelling",
    "completed",
    "completed_with_warnings",
    "failed",
  ],
  waiting_rate_limit: ["running", "cancelling", "failed"],
  cancelling: ["cancelled", "failed"],
  completed: [],
  completed_with_warnings: [],
  failed: [],
  cancelled: [],
};

export function canTransitionGeocodingBatch(
  from: GeocodingBatchStatus,
  to: GeocodingBatchStatus,
): boolean {
  return GEOCODING_BATCH_TRANSITIONS[from].includes(to);
}

export function assertGeocodingBatchTransition(
  from: GeocodingBatchStatus,
  to: GeocodingBatchStatus,
): void {
  if (!canTransitionGeocodingBatch(from, to)) {
    throw new Error(`invalid geocoding batch transition: ${from} -> ${to}`);
  }
}
