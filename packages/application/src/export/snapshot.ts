import {
  assertExportOptions,
  assertExportSnapshot,
  canonicalJson,
  hashCanonicalJson,
  type ExportAssetManifestEntry,
  type ExportOptions,
  type ExportSection,
  type ExportSnapshot,
} from "./contracts.js";

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = Object.freeze({
  paper: "A4",
  orientation: "portrait",
  sections: [
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
  ] as ExportSection[],
  mediaPolicy: "require_all",
});

export type ExportOptionsInput = Readonly<Partial<{
  paper: unknown;
  orientation: unknown;
  sections: unknown;
  mediaPolicy: unknown;
}>>;

export class ExportSnapshotValidationError extends Error {
  readonly code: "EXPORT_OPTIONS_INVALID" | "EXPORT_ASSETS_NOT_READY";

  constructor(code: "EXPORT_OPTIONS_INVALID" | "EXPORT_ASSETS_NOT_READY", message: string) {
    super(message);
    this.name = "ExportSnapshotValidationError";
    this.code = code;
  }
}

export function normalizeExportOptions(input: ExportOptionsInput = {}): ExportOptions {
  const sections = input.sections === undefined
    ? [...DEFAULT_EXPORT_OPTIONS.sections]
    : Array.isArray(input.sections)
      ? input.sections.filter((value): value is ExportSection => typeof value === "string")
      : [];
  const options = {
    paper: input.paper === undefined ? DEFAULT_EXPORT_OPTIONS.paper : input.paper,
    orientation: input.orientation === undefined ? DEFAULT_EXPORT_OPTIONS.orientation : input.orientation,
    sections,
    mediaPolicy: input.mediaPolicy === undefined ? DEFAULT_EXPORT_OPTIONS.mediaPolicy : input.mediaPolicy,
  } as unknown as ExportOptions;
  try {
    assertExportOptions(options);
  } catch (error) {
    throw new ExportSnapshotValidationError(
      "EXPORT_OPTIONS_INVALID",
      error instanceof Error ? error.message : "Export options are invalid",
    );
  }
  return Object.freeze({ ...options, sections: Object.freeze([...options.sections]) });
}

export function hashExportOptions(options: ExportOptions): string {
  assertExportOptions(options);
  return hashCanonicalJson(options);
}

export function hashExportTemplate(templateVersion: string): string {
  if (!templateVersion.trim()) throw new TypeError("Export template version is required");
  return hashCanonicalJson({ renderer: "on-the-road-pdf", templateVersion });
}

export function exportSnapshotHash(snapshot: ExportSnapshot): string {
  assertExportSnapshot(snapshot);
  return hashCanonicalJson({
    schemaVersion: snapshot.schemaVersion,
    tripId: snapshot.tripId,
    tripVersion: snapshot.tripVersion,
    facts: snapshot.facts,
    assets: snapshot.assets,
  });
}

export function exportSnapshotContent(snapshot: ExportSnapshot): string {
  assertExportSnapshot(snapshot);
  return canonicalJson({
    schemaVersion: snapshot.schemaVersion,
    tripId: snapshot.tripId,
    tripVersion: snapshot.tripVersion,
    facts: snapshot.facts,
    assets: snapshot.assets,
  });
}

export function blockingExportAssets(
  assets: readonly ExportAssetManifestEntry[],
): readonly ExportAssetManifestEntry[] {
  return assets.filter((asset) => asset.required && asset.status !== "ready");
}

export function assertExportAssetsReady(
  assets: readonly ExportAssetManifestEntry[],
): void {
  const blocking = blockingExportAssets(assets);
  if (blocking.length > 0) {
    throw new ExportSnapshotValidationError(
      "EXPORT_ASSETS_NOT_READY",
      `${blocking.length} required export asset(s) are not ready`,
    );
  }
}
