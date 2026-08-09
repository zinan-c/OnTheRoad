import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

export const LOCATION_STATUSES = Object.freeze([
  "unresolved",
  "resolving",
  "resolved",
  "ambiguous",
  "failed",
]);

const TRANSITIONS = Object.freeze({
  unresolved: new Set(["resolving", "resolved"]),
  resolving: new Set(["resolved", "ambiguous", "failed"]),
  ambiguous: new Set(["resolved"]),
  failed: new Set(["resolving"]),
  resolved: new Set(["resolved"]),
});

export class LocationDomainError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] */
  constructor(code, message, status = 400) {
    super(message);
    this.name = "LocationDomainError";
    this.code = code;
    this.status = status;
  }
}

/**
 * @param {unknown} current
 * @param {unknown} target
 * @param {{manual?: boolean, point?: unknown}} [options]
 */
export function assertLocationTransition(current, target, options = {}) {
  if (
    typeof current !== "string"
    || typeof target !== "string"
    || !LOCATION_STATUSES.includes(current)
    || !LOCATION_STATUSES.includes(target)
  ) {
    throw new LocationDomainError(
      "LOCATION_STATUS_INVALID",
      "Location status is invalid.",
    );
  }
  const allowed = /** @type {Record<string, Set<string>>} */ (TRANSITIONS);
  const manualFailureRecovery = current === "failed"
    && target === "resolved"
    && options.manual === true;
  if (!allowed[current]?.has(target) && !manualFailureRecovery) {
    throw new LocationDomainError(
      "INVALID_LOCATION_TRANSITION",
      `Location cannot transition from ${current} to ${target}.`,
      409,
    );
  }
  if (current === "resolved" && target === "resolved" && !options.manual) {
    throw new LocationDomainError(
      "RESOLVED_LOCATION_IMMUTABLE",
      "Only an explicit manual adjustment may change a resolved location.",
      409,
    );
  }
  if (target === "resolved" && !options.point) {
    throw new LocationDomainError(
      "RESOLVED_POINT_REQUIRED",
      "A resolved location requires a WGS84 point.",
    );
  }
  if (options.manual && target !== "resolved") {
    throw new LocationDomainError(
      "MANUAL_LOCATION_MUST_BE_RESOLVED",
      "A manual location adjustment must remain resolved.",
    );
  }
  return target;
}

/** @param {unknown} point */
export function assertWgs84Point(point) {
  const candidate = isRecord(point) ? point : {};
  if (
    candidate.crs !== "WGS84"
    || typeof candidate.latitude !== "number"
    || typeof candidate.longitude !== "number"
    || !Number.isFinite(candidate.latitude)
    || !Number.isFinite(candidate.longitude)
    || candidate.latitude < -90
    || candidate.latitude > 90
    || candidate.longitude < -180
    || candidate.longitude > 180
  ) {
    throw new LocationDomainError(
      "WGS84_POINT_INVALID",
      "Point must contain valid WGS84 longitude and latitude.",
    );
  }
  return Object.freeze({
    longitude: candidate.longitude,
    latitude: candidate.latitude,
    crs: "WGS84",
  });
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @returns {unknown} */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

/** @param {string} value */
function encode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

/** @param {string} value */
function decode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

export class CandidateTokenSigner {
  /**
   * @param {{secret: string, clock?: () => number, ttlMs?: number}} options
   */
  constructor({ secret, clock = () => Date.now(), ttlMs = 5 * 60_000 }) {
    if (typeof secret !== "string" || secret.length < 32) {
      throw new TypeError("Candidate token secret must contain at least 32 characters.");
    }
    this.secret = secret;
    this.clock = clock;
    this.ttlMs = ttlMs;
  }

  /**
   * @param {{
   *   ownerId: string,
   *   tripId: string,
   *   locationId: string,
   *   locationVersion: number,
   *   candidate: {
   *     attribution: string,
   *     countryCode?: string | null,
   *     formattedAddress?: string,
   *     city?: string | null,
   *     district?: string | null,
   *     confidence?: number | null,
   *     provider?: string,
   *     label: string,
   *     point: unknown,
   *     providerPlaceId: string
   *   }
   * }} input
   */
  sign({ ownerId, tripId, locationId, locationVersion, candidate }) {
    const point = assertWgs84Point(candidate.point);
    const payload = canonicalize({
      candidate: {
        attribution: candidate.attribution,
        countryCode: candidate.countryCode ?? null,
        ...(candidate.formattedAddress !== undefined ? { formattedAddress: candidate.formattedAddress } : {}),
        ...(candidate.city !== undefined ? { city: candidate.city } : {}),
        ...(candidate.district !== undefined ? { district: candidate.district } : {}),
        ...(candidate.confidence !== undefined ? { confidence: candidate.confidence } : {}),
        ...(candidate.provider !== undefined ? { provider: candidate.provider } : {}),
        label: candidate.label,
        point,
        providerPlaceId: candidate.providerPlaceId,
      },
      expiresAt: this.clock() + this.ttlMs,
      locationId,
      locationVersion,
      ownerId,
      tripId,
    });
    const body = encode(JSON.stringify(payload));
    const signature = createHmac("sha256", this.secret)
      .update(body)
      .digest("base64url");
    return `${body}.${signature}`;
  }

  /**
   * @param {unknown} token
   * @param {{ownerId: string, tripId: string, locationId: string, locationVersion: number}} context
   */
  verify(token, context) {
    const [body, suppliedSignature, extra] = String(token).split(".");
    if (!body || !suppliedSignature || extra) {
      throw new LocationDomainError(
        "CANDIDATE_TOKEN_INVALID",
        "Candidate token is malformed.",
      );
    }
    const expectedSignature = createHmac("sha256", this.secret)
      .update(body)
      .digest();
    let supplied;
    try {
      supplied = Buffer.from(suppliedSignature, "base64url");
    } catch {
      supplied = Buffer.alloc(0);
    }
    if (
      supplied.length !== expectedSignature.length
      || !timingSafeEqual(supplied, expectedSignature)
    ) {
      throw new LocationDomainError(
        "CANDIDATE_TOKEN_INVALID",
        "Candidate token signature is invalid.",
      );
    }
    /** @type {Record<string, unknown>} */
    let payload;
    try {
      const parsed = JSON.parse(decode(body));
      if (!isRecord(parsed)) throw new TypeError("payload");
      payload = parsed;
    } catch {
      throw new LocationDomainError(
        "CANDIDATE_TOKEN_INVALID",
        "Candidate token payload is invalid.",
      );
    }
    if (typeof payload.expiresAt !== "number" || payload.expiresAt < this.clock()) {
      throw new LocationDomainError(
        "CANDIDATE_TOKEN_EXPIRED",
        "Candidate token expired.",
        410,
      );
    }
    for (const field of ["ownerId", "tripId", "locationId", "locationVersion"]) {
      const expected = /** @type {Record<string, unknown>} */ (context)[field];
      if (payload[field] !== expected) {
        throw new LocationDomainError(
          "CANDIDATE_TOKEN_CONTEXT_MISMATCH",
          "Candidate token does not belong to this location version.",
          409,
        );
      }
    }
    if (!isRecord(payload.candidate)) {
      throw new LocationDomainError(
        "CANDIDATE_TOKEN_INVALID",
        "Candidate token candidate is invalid.",
      );
    }
    return Object.freeze({
      ...payload.candidate,
      point: assertWgs84Point(payload.candidate.point),
    });
  }
}
