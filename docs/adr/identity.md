# ADR-005: Development Identity and OIDC Boundary

- Status: Accepted for M1 Dev Track
- Date: 2026-07-29
- Task: A05

## Decision

The application uses one internal `Principal` contract regardless of how the
user authenticated:

```text
Principal {
  id: sha256(normalized issuer + NUL + subject)
  issuer: normalized HTTPS issuer URL
  subject: provider subject
}
```

Business modules authorize by `Principal.id` and an `ownerId` stored on every
owned resource. They do not branch on development identity versus OIDC.
Cross-owner reads and writes use the same not-found response as an unknown
resource, preventing resource enumeration.

Issuer paths are preserved because an OIDC issuer is an exact identifier, not
merely a host origin. Query strings, fragments, and non-HTTPS issuers are
rejected.

Development identity is an explicit local-only capability. Enabling it while
`NODE_ENV` is `staging` or `production` fails during identity construction.
The public Web application only links to API login/logout endpoints and never
receives an OIDC client Secret or a long-lived provider token.

## Session and callback contract

- The API uses an opaque server-side session record plus an HMAC-signed
  reference in the `__Host-otr_session` Cookie.
- Session and OIDC transaction Cookies are `HttpOnly`, `Secure`,
  `SameSite=Lax`, and `Path=/`.
- Login and logout require the exact configured application Origin.
- Authorization Code uses PKCE S256. State, nonce, verifier, issuer, expiry,
  and one-time transaction consumption are checked at callback.
- Logout deletes the server-side session before expiring the Cookie.
- Key rotation accepts an explicitly configured previous key for an overlap
  period while all new Cookies use the active key ID.
- Audit events contain action names, key IDs, principal IDs and truncated
  hashes only. Signing material, Cookies, codes, verifiers and tokens are not
  audit fields.

The in-memory stores implemented by A05 are the identity boundary used by the
Dev Track and its deterministic tests. A production deployment must provide a
shared, durable session/transaction adapter before horizontal scaling; this is
part of the Staging Identity Gate and cannot be inferred from mock OIDC.

## Runtime inputs

Dev Track:

- `OTR_APP_ORIGIN`
- `OTR_DEV_IDENTITY_ENABLED`
- `OTR_SESSION_SIGNING_KEY_ID`
- `OTR_SESSION_SIGNING_KEY`
- optional `OTR_SESSION_PREVIOUS_KEY_ID`
- optional `OTR_SESSION_PREVIOUS_SIGNING_KEY`

Staging Track additionally requires:

- `OTR_OIDC_ISSUER`
- `OTR_OIDC_CLIENT_ID`
- `OTR_OIDC_CLIENT_SECRET`
- `OTR_OIDC_CALLBACK_URL`
- `OTR_OIDC_POST_LOGOUT_REDIRECT_URL`

Secrets are injected at runtime and must never be committed, placed in browser
configuration, printed in errors, or saved in fixtures.

## Staging decision

The real provider, registered HTTPS callback and external Secret are not
available in the current workspace. The real Authorization Code + PKCE smoke
is therefore `BLOCKED`, not passed. The actionable handoff is recorded in
[`../reports/a05-staging-idp-handoff.md`](../reports/a05-staging-idp-handoff.md)
and every unchecked A05 item in
[`../runbooks/release-checklist.md`](../runbooks/release-checklist.md) remains a
release blocker.
