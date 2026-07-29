// @ts-nocheck
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
  constructor(code, message, status = 400) {
    super(message);
    this.name = "LocationDomainError";
    this.code = code;
    this.status = status;
  }
}

export function assertLocationTransition(current, target, options = {}) {
  if (!LOCATION_STATUSES.includes(current) || !LOCATION_STATUSES.includes(target)) {
    throw new LocationDomainError(
      "LOCATION_STATUS_INVALID",
      "Location status is invalid.",
    );
  }
  if (!TRANSITIONS[current].has(target)) {
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

export function assertWgs84Point(point) {
  if (
    !point
    || point.crs !== "WGS84"
    || !Number.isFinite(point.latitude)
    || !Number.isFinite(point.longitude)
    || point.latitude < -90
    || point.latitude > 90
    || point.longitude < -180
    || point.longitude > 180
  ) {
    throw new LocationDomainError(
      "WGS84_POINT_INVALID",
      "Point must contain valid WGS84 longitude and latitude.",
    );
  }
  return Object.freeze({
    longitude: point.longitude,
    latitude: point.latitude,
    crs: "WGS84",
  });
}

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

function encode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

export class CandidateTokenSigner {
  constructor({ secret, clock = () => Date.now(), ttlMs = 5 * 60_000 }) {
    if (typeof secret !== "string" || secret.length < 32) {
      throw new TypeError("Candidate token secret must contain at least 32 characters.");
    }
    this.secret = secret;
    this.clock = clock;
    this.ttlMs = ttlMs;
  }

  sign({ ownerId, tripId, locationId, locationVersion, candidate }) {
    const point = assertWgs84Point(candidate.point);
    const payload = canonicalize({
      candidate: {
        attribution: candidate.attribution,
        countryCode: candidate.countryCode ?? null,
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
    let payload;
    try {
      payload = JSON.parse(decode(body));
    } catch {
      throw new LocationDomainError(
        "CANDIDATE_TOKEN_INVALID",
        "Candidate token payload is invalid.",
      );
    }
    if (payload.expiresAt < this.clock()) {
      throw new LocationDomainError(
        "CANDIDATE_TOKEN_EXPIRED",
        "Candidate token expired.",
        410,
      );
    }
    for (const field of ["ownerId", "tripId", "locationId", "locationVersion"]) {
      if (payload[field] !== context[field]) {
        throw new LocationDomainError(
          "CANDIDATE_TOKEN_CONTEXT_MISMATCH",
          "Candidate token does not belong to this location version.",
          409,
        );
      }
    }
    return Object.freeze({
      ...payload.candidate,
      point: assertWgs84Point(payload.candidate.point),
    });
  }
}
