// @ts-nocheck
import { OidcFlowError } from "./errors.mjs";
import { pkceChallenge, randomValue } from "./crypto.mjs";

export class MockOidcProvider {
  #codes = new Map();

  constructor({
    issuer,
    subjectNamespace = issuer,
  }) {
    this.issuer = new URL(issuer).href;
    this.subjectNamespace = new URL(subjectNamespace).href;
  }

  authorizationUrl({ state, nonce, codeChallenge }) {
    const url = new URL("/authorize", this.issuer);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.href;
  }

  issueCode({ subject, nonce, codeChallenge }) {
    const code = randomValue(24);
    this.#codes.set(code, { subject, nonce, codeChallenge });
    return code;
  }

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
