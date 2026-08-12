import { createHash } from "node:crypto";

export const EXPORT_JOB_STATUSES = [
  "snapshotting",
  "queued",
  "waiting_assets",
  "rendering",
  "validating",
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelling",
  "cancelled",
] as const;

export const EXPORT_QUEUE_NAME = "otr.pdf";
export const EXPORT_QUEUE_JOB_NAME = "export.render";

export type ExportJobStatus = (typeof EXPORT_JOB_STATUSES)[number];

export const EXPORT_JOB_STAGES = [
  "snapshot",
  "assets",
  "render",
  "validate",
  "complete",
] as const;

export type ExportJobStage = (typeof EXPORT_JOB_STAGES)[number];

export const EXPORT_SECTIONS = [
  "cover",
  "overview",
  "global_map",
  "daily_itinerary",
  "daily_map",
  "gallery",
  "accommodation",
  "transport",
  "expenses",
  "notes",
  "omissions",
] as const;

export type ExportSection = (typeof EXPORT_SECTIONS)[number];

export type ExportOptions = Readonly<{
  paper: "A4";
  orientation: "portrait" | "landscape";
  sections: readonly ExportSection[];
  mediaPolicy: "require_all" | "ready_only" | "exclude";
}>;

export type ExportAssetKind = "image" | "map" | "font";

export const EXPORT_ASSET_STATUSES = [
  "ready",
  "processing",
  "missing",
  "failed",
  "excluded",
] as const;

export type ExportAssetStatus = (typeof EXPORT_ASSET_STATUSES)[number];

export type ExportAssetManifestEntry = Readonly<{
  id: string;
  kind: ExportAssetKind;
  contentType: string;
  checksumSha256: string | null;
  objectVersion: string | null;
  width: number | null;
  height: number | null;
  required: boolean;
  status: ExportAssetStatus;
  omissionReason: string | null;
}>;

export type ExportSnapshot = Readonly<{
  schemaVersion: number;
  tripId: string;
  tripVersion: number;
  facts: Readonly<Record<string, unknown>>;
  assets: readonly ExportAssetManifestEntry[];
  capturedAt: string;
}>;

export type ExportJob = Readonly<{
  id: string;
  tripId: string;
  tripVersion: number;
  createdBy: string;
  idempotencyKey: string;
  status: ExportJobStatus;
  stage: ExportJobStage;
  options: ExportOptions;
  optionsHash: string;
  templateVersion: string;
  templateHash: string;
  snapshotHash: string | null;
  snapshot: ExportSnapshot | null;
  assetManifest: readonly ExportAssetManifestEntry[];
  omissionCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}>;

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashCanonicalJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function assertExportOptions(options: ExportOptions): void {
  if (options.paper !== "A4") throw new TypeError("Only A4 export is supported");
  if (!(options.orientation === "portrait" || options.orientation === "landscape")) {
    throw new TypeError("Export orientation is invalid");
  }
  if (options.sections.some((section) => !EXPORT_SECTIONS.includes(section))) {
    throw new TypeError("Export sections are invalid");
  }
  if (!(["require_all", "ready_only", "exclude"] as const).includes(options.mediaPolicy)) {
    throw new TypeError("Export media policy is invalid");
  }
  if (new Set(options.sections).size !== options.sections.length) {
    throw new TypeError("Export sections must not repeat");
  }
}

export function assertExportSnapshot(snapshot: ExportSnapshot): void {
  if (!Number.isSafeInteger(snapshot.schemaVersion) || snapshot.schemaVersion < 1) {
    throw new TypeError("Export snapshot schema version must be positive");
  }
  if (!Number.isSafeInteger(snapshot.tripVersion) || snapshot.tripVersion < 1) {
    throw new TypeError("Export snapshot trip version must be positive");
  }
  if (!snapshot.facts || typeof snapshot.facts !== "object" || Array.isArray(snapshot.facts)) {
    throw new TypeError("Export snapshot facts must be an object");
  }
  if (!Array.isArray(snapshot.assets)) throw new TypeError("Export snapshot assets must be an array");
  const assetIds = new Set<string>();
  for (const asset of snapshot.assets) {
    if (!EXPORT_ASSET_STATUSES.includes(asset.status)) {
      throw new TypeError(`Unsupported export asset status: ${asset.status}`);
    }
    if (assetIds.has(asset.id)) throw new TypeError("Export snapshot asset ids must be unique");
    assetIds.add(asset.id);
    if (asset.status === "ready" && !/^[a-f0-9]{64}$/u.test(asset.checksumSha256 ?? "")) {
      throw new TypeError("Ready export snapshot assets require a SHA-256 checksum");
    }
    if (asset.status === "ready" && !asset.objectVersion) {
      throw new TypeError("Ready export snapshot assets require an immutable object version");
    }
    if ((["missing", "failed", "excluded"] as readonly ExportAssetStatus[]).includes(asset.status)
      && !asset.omissionReason?.trim()) {
      throw new TypeError("Omitted export snapshot assets require a reason");
    }
    if (asset.checksumSha256 !== null && !/^[a-f0-9]{64}$/u.test(asset.checksumSha256)) {
      throw new TypeError("Export snapshot asset checksums must be SHA-256 hex");
    }
  }

  assertSnapshotContainsNoSignedUrls(snapshot);
}

function assertSnapshotContainsNoSignedUrls(value: unknown, path = "snapshot"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSnapshotContainsNoSignedUrls(item, `${path}[${index}]`));
    return;
  }

  if (value === null || typeof value !== "object") return;

  for (const [key, nestedValue] of Object.entries(value)) {
    if (/signed[_-]?url|presigned[_-]?url/i.test(key)) {
      throw new Error(`export snapshot must not contain ephemeral URL field: ${path}.${key}`);
    }
    assertSnapshotContainsNoSignedUrls(nestedValue, `${path}.${key}`);
  }
}

export const EXPORT_JOB_TRANSITIONS: Readonly<
  Record<ExportJobStatus, readonly ExportJobStatus[]>
> = {
  snapshotting: ["queued", "cancelling", "cancelled", "failed"],
  queued: ["waiting_assets", "rendering", "cancelling", "cancelled", "failed"],
  waiting_assets: ["rendering", "cancelling", "cancelled", "failed"],
  rendering: ["validating", "cancelling", "failed"],
  validating: ["completed", "completed_with_warnings", "cancelling", "failed"],
  completed: [],
  completed_with_warnings: [],
  failed: [],
  cancelling: ["cancelled", "failed"],
  cancelled: [],
};

export function canTransitionExportJob(
  from: ExportJobStatus,
  to: ExportJobStatus,
): boolean {
  return EXPORT_JOB_TRANSITIONS[from].includes(to);
}

export function assertExportJobTransition(from: ExportJobStatus, to: ExportJobStatus): void {
  if (!canTransitionExportJob(from, to)) {
    throw new Error(`invalid export job transition: ${from} -> ${to}`);
  }
}
