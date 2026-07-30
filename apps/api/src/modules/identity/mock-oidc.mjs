import { OidcFlowError } from "./errors.mjs";
import { pkceChallenge, randomValue } from "./crypto.mjs";

export class MockOidcProvider {
  /** @type {Map<string, {subject: string, nonce: string, codeChallenge: string}>} */
  #codes = new Map();

  /** @param {{issuer: string, subjectNamespace?: string}} options */
  constructor({
    issuer,
    subjectNamespace = issuer,
  }) {
    this.issuer = new URL(issuer).href;
    this.subjectNamespace = new URL(subjectNamespace).href;
  }

  /** @param {{state: string, nonce: string, codeChallenge: string}} input */
  authorizationUrl({ state, nonce, codeChallenge }) {
    const url = new URL("/authorize", this.issuer);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.href;
  }

  /** @param {{subject: string, nonce: string, codeChallenge: string}} input */
  issueCode({ subject, nonce, codeChallenge }) {
    const code = randomValue(24);
    this.#codes.set(code, { subject, nonce, codeChallenge });
    return code;
  }

  /** @param {{code: string, codeVerifier: string}} input */
  async exchangeCode({ code, codeVerifier }) {
    const grant = this.#codes.get(code);
    this.#codes.delete(code);
    if (!grant || grant.codeChallenge !== pkceChallenge(codeVerifier)) {
      throw new OidcFlowError("OIDC_CODE_REJECTED", "OIDC code or PKCE verifier is invalid");
    }
    return {
      issuer: this.subjectNamespace,
      subject: grant.subject,
      nonce: grant.nonce,
    };
  }
}
