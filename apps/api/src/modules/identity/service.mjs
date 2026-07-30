import { createHash } from "node:crypto";
import { pkceChallenge, randomValue, signPayload, verifyPayload } from "./crypto.mjs";
import {
  IdentityConfigurationError,
  OidcFlowError,
  SessionError,
} from "./errors.mjs";

const DEV_ISSUER = "https://dev-identity.local";
const SESSION_COOKIE = "__Host-otr_session";
const TRANSACTION_COOKIE = "__Host-otr_oidc";
const SUBJECT_PATTERN = /^[A-Za-z0-9._:@/-]{1,255}$/u;

/**
 * @typedef {{id: string, issuer: string, subject: string}} Principal
 * @typedef {{id: string, secret: string}} SigningKey
 * @typedef {{active: SigningKey, previous?: SigningKey}} SigningKeys
 * @typedef {{
 *  issuer: string,
 *  authorizationUrl(input: {state: string, nonce: string, codeChallenge: string}): string,
 *  exchangeCode(input: {code: string, codeVerifier: string}): Promise<{issuer: string, subject: string, nonce: string}>
 * }} OidcProvider
 */

/** @param {{issuer: string, subject: string}} input */
function createPrincipal({ issuer, subject }) {
  const issuerUrl = new URL(issuer);
  if (issuerUrl.protocol !== "https:" || issuerUrl.search || issuerUrl.hash) {
    throw new OidcFlowError("OIDC_ISSUER_REJECTED", "OIDC issuer is invalid");
  }
  const normalizedIssuer = issuerUrl.href;
  if (!SUBJECT_PATTERN.test(subject)) {
    throw new OidcFlowError("OIDC_SUBJECT_REJECTED", "Identity subject is invalid");
  }
  return Object.freeze({
    id: createHash("sha256")
      .update(`${normalizedIssuer}\u0000${subject}`)
      .digest("base64url"),
    issuer: normalizedIssuer,
    subject,
  });
}

/** @param {string} name @param {string} value @param {number} maxAgeSeconds */
function hardenedCookie(name, value, maxAgeSeconds) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

/** @param {string} actual @param {string} expected */
function assertOrigin(actual, expected) {
  if (actual !== expected) {
    throw new OidcFlowError("ORIGIN_REJECTED", "Request origin is not allowed");
  }
}

/** @param {string} value */
function fingerprint(value) {
  return createHash("sha256").update(value).digest("base64url").slice(0, 12);
}

export class IdentityService {
  /** @type {(event: Record<string, unknown>) => void} */
  #audit;
  /** @type {() => number} */
  #clock;
  /** @type {Map<string, {principal: Principal, expiresAt: number}>} */
  #sessions = new Map();
  /** @type {Map<string, {state: string, nonce: string, codeVerifier: string, expiresAt: number, providerIssuer: string}>} */
  #transactions = new Map();

  /**
   * @param {{
   *  environment: string,
   *  developmentIdentityEnabled: boolean,
   *  appOrigin: string,
   *  signingKeys: SigningKeys,
   *  sessionTtlMs?: number,
   *  transactionTtlMs?: number,
   *  clock?: () => number,
   *  audit?: (event: Record<string, unknown>) => void
   * }} options
   */
  constructor({
    environment,
    developmentIdentityEnabled,
    appOrigin,
    signingKeys,
    sessionTtlMs = 8 * 60 * 60 * 1000,
    transactionTtlMs = 5 * 60 * 1000,
    clock = Date.now,
    audit = () => {},
  }) {
    if (developmentIdentityEnabled && environment !== "development") {
      throw new IdentityConfigurationError(
        "DEVELOPMENT_IDENTITY_FORBIDDEN",
        "Development identity is forbidden outside development",
      );
    }
    if (!signingKeys?.active?.id || !signingKeys.active.secret) {
      throw new IdentityConfigurationError(
        "SESSION_SIGNING_KEY_REQUIRED",
        "An active session signing key is required",
      );
    }
    if (signingKeys.active.secret.length < 32) {
      throw new IdentityConfigurationError(
        "SESSION_SIGNING_KEY_WEAK",
        "Session signing key must contain at least 32 characters",
      );
    }
    this.environment = environment;
    this.developmentIdentityEnabled = developmentIdentityEnabled;
    this.appOrigin = new URL(appOrigin).origin;
    this.signingKeys = signingKeys;
    this.sessionTtlMs = sessionTtlMs;
    this.transactionTtlMs = transactionTtlMs;
    this.#clock = clock;
    this.#audit = audit;
  }

  /** @param {() => number} clock */
  setClock(clock) {
    this.#clock = clock;
  }

  /** @param {SigningKeys} signingKeys */
  rotateSigningKey(signingKeys) {
    if (
      signingKeys.active.secret.length < 32
      || (signingKeys.previous && signingKeys.previous.secret.length < 32)
    ) {
      throw new IdentityConfigurationError(
        "SESSION_SIGNING_KEY_WEAK",
        "Session signing key must contain at least 32 characters",
      );
    }
    this.signingKeys = signingKeys;
    this.#audit({
      action: "identity.signing-key.rotated",
      activeKeyId: signingKeys.active.id,
      previousKeyId: signingKeys.previous?.id,
    });
  }

  /** @param {{subject: string, origin: string}} input */
  loginWithDevelopmentIdentity({ subject, origin }) {
    assertOrigin(origin, this.appOrigin);
    if (!this.developmentIdentityEnabled || this.environment !== "development") {
      throw new IdentityConfigurationError(
        "DEVELOPMENT_IDENTITY_DISABLED",
        "Development identity is disabled",
      );
    }
    return this.#createSession(createPrincipal({ issuer: DEV_ISSUER, subject }), "development");
  }

  /** @param {{provider: OidcProvider}} input */
  beginOidcAuthorization({ provider }) {
    const state = randomValue();
    const nonce = randomValue();
    const codeVerifier = randomValue(48);
    const codeChallenge = pkceChallenge(codeVerifier);
    const transactionId = randomValue();
    const expiresAt = this.#clock() + this.transactionTtlMs;
    this.#transactions.set(transactionId, {
      state,
      nonce,
      codeVerifier,
      expiresAt,
      providerIssuer: provider.issuer,
    });
    return {
      authorizationUrl: provider.authorizationUrl({ state, nonce, codeChallenge }),
      codeChallenge,
      nonce,
      state,
      transactionCookie: transactionId,
      setCookie: hardenedCookie(
        TRANSACTION_COOKIE,
        transactionId,
        Math.ceil(this.transactionTtlMs / 1000),
      ),
    };
  }

  /** @param {{provider: OidcProvider, code: string, state: string, transactionCookie: string, origin: string}} input */
  async completeOidcAuthorization({
    provider,
    code,
    state,
    transactionCookie,
    origin,
  }) {
    assertOrigin(origin, this.appOrigin);
    const transaction = this.#transactions.get(transactionCookie);
    this.#transactions.delete(transactionCookie);
    if (!transaction || transaction.state !== state) {
      throw new OidcFlowError("OIDC_STATE_REJECTED", "OIDC state is invalid");
    }
    if (transaction.expiresAt <= this.#clock()) {
      throw new OidcFlowError("OIDC_TRANSACTION_EXPIRED", "OIDC transaction expired");
    }
    if (transaction.providerIssuer !== provider.issuer) {
      throw new OidcFlowError("OIDC_ISSUER_REJECTED", "OIDC issuer changed during callback");
    }
    const claims = await provider.exchangeCode({
      code,
      codeVerifier: transaction.codeVerifier,
    });
    if (claims.nonce !== transaction.nonce) {
      throw new OidcFlowError("OIDC_NONCE_REJECTED", "OIDC nonce is invalid");
    }
    const session = this.#createSession(
      createPrincipal({ issuer: claims.issuer, subject: claims.subject }),
      "oidc",
    );
    return {
      ...session,
      clearTransactionCookie: hardenedCookie(TRANSACTION_COOKIE, "", 0),
    };
  }

  /** @param {string} token */
  authenticate(token) {
    const rawPayload = verifyPayload(
      token,
      [this.signingKeys.active, this.signingKeys.previous]
        .filter((key) => key !== undefined),
    );
    const payload = rawPayload && typeof rawPayload === "object"
      ? /** @type {Record<string, unknown>} */ (rawPayload)
      : null;
    if (
      !payload
      || typeof payload.sessionId !== "string"
      || typeof payload.expiresAt !== "number"
      || payload.expiresAt <= this.#clock()
    ) {
      throw new SessionError("SESSION_INVALID");
    }
    const session = this.#sessions.get(payload.sessionId);
    if (!session || session.expiresAt !== payload.expiresAt) {
      throw new SessionError("SESSION_INVALID");
    }
    return session.principal;
  }

  /** @param {{token: string, origin: string}} input */
  logout({ token, origin }) {
    assertOrigin(origin, this.appOrigin);
    const rawPayload = verifyPayload(
      token,
      [this.signingKeys.active, this.signingKeys.previous]
        .filter((key) => key !== undefined),
    );
    const payload = rawPayload && typeof rawPayload === "object"
      ? /** @type {Record<string, unknown>} */ (rawPayload)
      : null;
    const sessionId = typeof payload?.sessionId === "string"
      ? payload.sessionId
      : null;
    if (sessionId) this.#sessions.delete(sessionId);
    this.#audit({
      action: "identity.session.logged-out",
      session: sessionId ? fingerprint(sessionId) : "invalid",
    });
    return {
      setCookie: hardenedCookie(SESSION_COOKIE, "", 0),
    };
  }

  /** @param {Principal} principal @param {"development" | "oidc"} method */
  #createSession(principal, method) {
    const sessionId = randomValue();
    const expiresAt = this.#clock() + this.sessionTtlMs;
    this.#sessions.set(sessionId, { principal, expiresAt });
    const token = signPayload({ sessionId, expiresAt }, this.signingKeys.active);
    this.#audit({
      action: "identity.session.created",
      method,
      principalId: principal.id,
      session: fingerprint(sessionId),
      signingKeyId: this.signingKeys.active.id,
    });
    return {
      principal,
      token,
      setCookie: hardenedCookie(
        SESSION_COOKIE,
        token,
        Math.ceil(this.sessionTtlMs / 1000),
      ),
    };
  }
}
