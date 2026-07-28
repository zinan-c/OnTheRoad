# Release checklist

## A02 Compose parity gate

This section is mandatory before the first production release whenever the
development environment completed A02 through Native Track.

- [ ] A supported container engine and Compose v2 are available in CI/staging.
- [ ] The pinned PostGIS, Redis, MinIO, MinIO client, and ClamAV images resolve
      for the target Linux architecture.
- [ ] A clean-volume Compose start reaches healthy state.
- [ ] The shared probe confirms PostGIS extension, authenticated Redis `PONG`,
      S3 put/get, and ClamAV TCP readiness.
- [ ] Bucket and database initialization are idempotent.
- [ ] PostgreSQL, Redis, and S3 data survive individual service restarts.
- [ ] The EICAR fixture is detected as infected.
- [ ] Stopping ClamAV makes media readiness fail closed.
- [ ] Service DNS, non-root/read-only boundaries, ports, CPU, and memory limits
      match the deployment contract.
- [ ] Compose and Native Track expose equivalent environment variables,
      capabilities, readiness states, and redacted errors.
- [ ] Image/version metadata and test output are attached to the release record.

Any unchecked item blocks release. Native Track evidence cannot waive this
gate.

### Current handoff — 2026-07-28

- Status: deferred to release validation; this does not block the current
  Native A02 development gate.
- Docker Desktop daemon and Compose v5.2.0 were reachable on macOS arm64.
- The first pull attempt could not find Docker Desktop's credential helper in
  the non-interactive shell PATH.
- After adding `/Applications/Docker.app/Contents/Resources/bin` to that
  command's PATH, image layer downloads began.
- The attempt stopped without retry or mirror fallback when
  `clamav/clamav:1.4.3` failed with
  `TLS handshake timeout` against `registry-1.docker.io`; the other image pulls
  were interrupted.
- No Compose readiness, persistence, EICAR, or parity item above is considered
  passed by this partial pull.

## A05 staging identity gate

This section is mandatory before the first production release whenever the
development milestone completed A05 through the Dev Identity/Mock OIDC Track.

- [ ] The production OIDC provider decision and issuer are recorded in the
      identity ADR.
- [ ] A dedicated staging client is configured; its client ID is expected and
      its Secret is supplied only through the approved external Secret store.
- [ ] Exact HTTPS callback, allowed origin, and post-logout redirect URIs are
      registered in the staging IdP. Wildcard redirects are rejected.
- [ ] Development identity is disabled and fails closed in staging and
      production configurations.
- [ ] `tests/identity/oidc-release.e2e.spec.ts` completes a real Authorization
      Code + PKCE login and callback against the staging IdP.
- [ ] The real flow verifies state, nonce, PKCE verifier, callback expiry,
      CSRF/Origin checks, and replay rejection.
- [ ] Session cookies on staging are HttpOnly, Secure, and use the approved
      SameSite policy; browser storage and responses contain no long-lived
      token or client Secret.
- [ ] RP-initiated logout or the documented provider-specific logout flow
      invalidates the application session and returns only to an allowlisted
      URI.
- [ ] Signing key and/or client Secret rotation is rehearsed using the
      documented overlap policy; new sessions work and old sessions follow the
      declared acceptance or revocation behavior.
- [ ] IdP outage, discovery/JWKS timeout, invalid signature, expired token, and
      rejected Cookie paths fail closed with redacted diagnostics.
- [ ] Cross-owner enumeration still returns the documented 404/403 behavior
      through the real authenticated session.
- [ ] Application logs, traces, browser bundles, CI output, and release
      artifacts have been checked for issuer credentials, tokens, Cookie
      values, and signing material.
- [ ] Issuer/client/callback metadata, redacted test output, key versions, test
      timestamp, and approver are attached to the release record.

Any unchecked item blocks release. Dev Identity or Mock OIDC evidence cannot
waive this gate.

### Current handoff — 2026-07-29

- Status: deferred to staging/release validation; this does not block the
  current A05 development gate once its Dev Track passes.
- OIDC provider, staging origin, issuer, client registration, and staging
  Secret have not yet been supplied or validated.
- No real callback, HTTPS Cookie, provider logout, external Secret rotation, or
  staging outage item above is considered passed.
