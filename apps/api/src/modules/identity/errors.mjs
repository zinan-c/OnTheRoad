// @ts-nocheck
export class IdentityConfigurationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "IdentityConfigurationError";
    this.code = code;
  }
}

export class SessionError extends Error {
  constructor(code, message = "Session is invalid") {
    super(message);
    this.name = "SessionError";
    this.code = code;
    this.status = 401;
  }
}

export class OidcFlowError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OidcFlowError";
    this.code = code;
    this.status = 400;
  }
}
