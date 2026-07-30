import { createHash } from "node:crypto";

const SUBJECT_PATTERN = /^[A-Za-z0-9._:@/-]{1,255}$/u;

export class InvalidPrincipalError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "InvalidPrincipalError";
    this.code = "INVALID_PRINCIPAL";
  }
}

export class ResourceNotFoundError extends Error {
  constructor() {
    super("Resource not found");
    this.name = "ResourceNotFoundError";
    this.code = "RESOURCE_NOT_FOUND";
    this.status = 404;
  }
}

/**
 * @typedef {{id: string, issuer: string, subject: string}} Principal
 * @typedef {{ownerId: string} & Record<string, unknown>} OwnedResource
 */

/** @param {{issuer: string, subject: string}} input */
export function createPrincipal({ issuer, subject }) {
  let normalizedIssuer;
  try {
    const issuerUrl = new URL(issuer);
    if (issuerUrl.protocol !== "https:" || issuerUrl.search || issuerUrl.hash) {
      throw new Error("issuer");
    }
    normalizedIssuer = issuerUrl.href;
  } catch {
    throw new InvalidPrincipalError(
      "Principal issuer must be an absolute HTTPS URL without query or fragment",
    );
  }
  if (!SUBJECT_PATTERN.test(subject)) {
    throw new InvalidPrincipalError("Principal subject is invalid");
  }
  const id = createHash("sha256")
    .update(`${normalizedIssuer}\u0000${subject}`)
    .digest("base64url");

  return Object.freeze({
    id,
    issuer: normalizedIssuer,
    subject,
  });
}

/**
 * @template {OwnedResource} Resource
 * @param {Principal | null | undefined} principal
 * @param {Resource | null | undefined} resource
 * @returns {Resource}
 */
export function assertResourceOwner(principal, resource) {
  if (!principal || !resource || resource.ownerId !== principal.id) {
    throw new ResourceNotFoundError();
  }
  return resource;
}
