export class IdentityConfigurationError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "IdentityConfigurationError";
    this.code = code;
  }
}

export class SessionError extends Error {
  /** @param {string} code @param {string} [message] @param {number} [status] */
  constructor(code, message = "Session is invalid", status = 401) {
    super(message);
    this.name = "SessionError";
    this.code = code;
    this.status = status;
  }
}

export class OidcFlowError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "OidcFlowError";
    this.code = code;
    this.status = 400;
  }
}
