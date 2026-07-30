export type Wgs84Point = Readonly<{
  longitude: number;
  latitude: number;
  crs: "WGS84";
}>;

export type CoordinateInputMode = "mouse" | "touch" | "keyboard" | "manual";

export type CoordinateLocation = Readonly<{
  id: string;
  ownerId: string;
  version: number;
  status: "unresolved" | "resolving" | "resolved" | "ambiguous" | "failed";
  point: Wgs84Point | null;
  manuallyAdjusted: boolean;
  name?: string;
  formattedAddress?: string | null;
}>;

export type CoordinateAudit = Readonly<{
  locationId: string;
  ownerId: string;
  action:
    | "location.coordinates.map-picked"
    | "location.coordinates.marker-dragged"
    | "location.coordinates.manually-entered";
  fromVersion: number;
  toVersion: number;
  point: Wgs84Point;
  inputMode: CoordinateInputMode;
  reverseStatus: "resolved" | "failed" | "not-requested";
  occurredAt: string;
}>;

export class CoordinateAdjustmentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "CoordinateAdjustmentError";
  }
}

export function assertWgs84(point: Wgs84Point): Wgs84Point {
  if (
    point?.crs !== "WGS84"
    || !Number.isFinite(point.longitude)
    || !Number.isFinite(point.latitude)
    || point.longitude < -180
    || point.longitude > 180
    || point.latitude < -90
    || point.latitude > 90
  ) {
    throw new CoordinateAdjustmentError(
      "WGS84_POINT_INVALID",
      "Coordinates must be valid WGS84 longitude and latitude.",
    );
  }
  return Object.freeze({ ...point });
}

export interface ReverseResult {
  readonly label: string;
  readonly formattedAddress?: string;
}

export interface ManualAdjustment {
  readonly ownerId: string;
  readonly locationId: string;
  readonly expectedVersion: number;
  readonly point: Wgs84Point;
  readonly action: CoordinateAudit["action"];
  readonly inputMode: CoordinateInputMode;
  readonly reverseStatus: CoordinateAudit["reverseStatus"];
  readonly reverseResult?: ReverseResult;
}

export interface CoordinateRepository {
  get(ownerId: string, locationId: string): Promise<CoordinateLocation>;
  manualAdjust(input: ManualAdjustment): Promise<CoordinateLocation>;
  applyGeocodeIfCurrent(input: {
    readonly ownerId: string;
    readonly locationId: string;
    readonly expectedVersion: number;
    readonly point: Wgs84Point;
    readonly label: string;
  }): Promise<{ readonly affectedRows: 0 | 1; readonly location?: CoordinateLocation }>;
  audits(
    ownerId: string,
    locationId?: string,
  ): readonly CoordinateAudit[] | Promise<readonly CoordinateAudit[]>;
}

export class CoordinateAdjustmentService {
  constructor(readonly repository: CoordinateRepository) {}

  async pickOnMap(
    ownerId: string,
    locationId: string,
    expectedVersion: number,
    point: Wgs84Point,
    reverse?: (point: Wgs84Point) => Promise<ReverseResult>,
  ): Promise<{
    location: CoordinateLocation;
    reverse: { status: "resolved"; result: ReverseResult } | { status: "failed" | "not-requested" };
  }> {
    const normalized = assertWgs84(point);
    let reverseResult: ReverseResult | undefined;
    let reverseStatus: CoordinateAudit["reverseStatus"] = reverse ? "failed" : "not-requested";
    if (reverse) {
      try {
        reverseResult = await reverse(normalized);
        reverseStatus = "resolved";
      } catch {
        // A point is a valid user fact even when optional reverse lookup fails.
      }
    }
    const location = await this.repository.manualAdjust({
      ownerId,
      locationId,
      expectedVersion,
      point: normalized,
      action: "location.coordinates.map-picked",
      inputMode: "mouse",
      reverseStatus,
      ...(reverseResult ? { reverseResult } : {}),
    });
    if (reverseResult) {
      return {
        location,
        reverse: { status: "resolved", result: reverseResult },
      };
    }
    return {
      location,
      reverse: { status: reverseStatus === "resolved" ? "failed" : reverseStatus },
    };
  }

  dragMarker(
    ownerId: string,
    locationId: string,
    expectedVersion: number,
    point: Wgs84Point,
    inputMode: CoordinateInputMode = "mouse",
  ): Promise<CoordinateLocation> {
    return this.repository.manualAdjust({
      ownerId,
      locationId,
      expectedVersion,
      point: assertWgs84(point),
      action: "location.coordinates.marker-dragged",
      inputMode,
      reverseStatus: "not-requested",
    });
  }

  manuallyEnter(
    ownerId: string,
    locationId: string,
    expectedVersion: number,
    point: Wgs84Point,
  ): Promise<CoordinateLocation> {
    return this.repository.manualAdjust({
      ownerId,
      locationId,
      expectedVersion,
      point: assertWgs84(point),
      action: "location.coordinates.manually-entered",
      inputMode: "manual",
      reverseStatus: "not-requested",
    });
  }

  async applyGeocodeResult(
    ownerId: string,
    locationId: string,
    expectedVersion: number,
    candidate: { readonly point: Wgs84Point; readonly label: string },
  ): Promise<{ affectedRows: 0 | 1; discarded: boolean }> {
    const result = await this.repository.applyGeocodeIfCurrent({
      ownerId,
      locationId,
      expectedVersion,
      point: assertWgs84(candidate.point),
      label: candidate.label,
    });
    return { affectedRows: result.affectedRows, discarded: result.affectedRows === 0 };
  }
}

export class InMemoryCoordinateRepository implements CoordinateRepository {
  readonly #locations = new Map<string, CoordinateLocation>();
  readonly #audits: CoordinateAudit[] = [];
  readonly #clock: () => Date;

  constructor(
    locations: readonly CoordinateLocation[],
    clock: () => Date = () => new Date(),
  ) {
    for (const location of locations) {
      this.#locations.set(this.#key(location.ownerId, location.id), structuredClone(location));
    }
    this.#clock = clock;
  }

  async get(ownerId: string, locationId: string): Promise<CoordinateLocation> {
    return structuredClone(this.#current(ownerId, locationId));
  }

  async manualAdjust(input: ManualAdjustment): Promise<CoordinateLocation> {
    const current = this.#current(input.ownerId, input.locationId);
    if (current.version !== input.expectedVersion) {
      throw new CoordinateAdjustmentError(
        "LOCATION_VERSION_CONFLICT",
        "If-Match does not match the current Location version.",
        409,
      );
    }
    const updated: CoordinateLocation = {
      ...current,
      version: current.version + 1,
      status: "resolved",
      point: input.point,
      manuallyAdjusted: true,
      ...(input.reverseResult?.label ? { name: input.reverseResult.label } : {}),
      ...(input.reverseResult?.formattedAddress
        ? { formattedAddress: input.reverseResult.formattedAddress }
        : {}),
    };
    this.#locations.set(this.#key(input.ownerId, input.locationId), updated);
    this.#audits.push({
      locationId: input.locationId,
      ownerId: input.ownerId,
      action: input.action,
      fromVersion: current.version,
      toVersion: updated.version,
      point: input.point,
      inputMode: input.inputMode,
      reverseStatus: input.reverseStatus,
      occurredAt: this.#clock().toISOString(),
    });
    return structuredClone(updated);
  }

  async applyGeocodeIfCurrent(input: {
    readonly ownerId: string;
    readonly locationId: string;
    readonly expectedVersion: number;
    readonly point: Wgs84Point;
    readonly label: string;
  }): Promise<{ affectedRows: 0 | 1; location?: CoordinateLocation }> {
    const current = this.#current(input.ownerId, input.locationId);
    if (current.version !== input.expectedVersion || current.manuallyAdjusted) {
      return { affectedRows: 0 };
    }
    const updated: CoordinateLocation = {
      ...current,
      point: input.point,
      name: input.label,
      status: "resolved",
      version: current.version + 1,
    };
    this.#locations.set(this.#key(input.ownerId, input.locationId), updated);
    return { affectedRows: 1, location: structuredClone(updated) };
  }

  audits(ownerId?: string, locationId?: string): readonly CoordinateAudit[] {
    return structuredClone(this.#audits.filter((audit) =>
      (!ownerId || audit.ownerId === ownerId)
      && (!locationId || audit.locationId === locationId)));
  }

  #key(ownerId: string, locationId: string): string {
    return `${ownerId}\u0000${locationId}`;
  }

  #current(ownerId: string, locationId: string): CoordinateLocation {
    const current = this.#locations.get(this.#key(ownerId, locationId));
    if (!current) {
      throw new CoordinateAdjustmentError("LOCATION_NOT_FOUND", "Location not found.", 404);
    }
    return current;
  }
}
