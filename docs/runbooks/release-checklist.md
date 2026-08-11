# Release checklist

## Current development baseline

M3 is Done for the Dev Track at closure SHA
`10d7c1d03c7a1df579ac37f79b71bbfef5919424`; see the
[M3 Gate report](../reports/m3-gate.md). That result proves the native Dev
runtime and all 129 M0–M3 required Cases. It does not check any box below.

Run release checks only against an immutable, clean release-candidate SHA.
Archive the full SHA, workflow run, environment, image versions, timestamps,
approvers, and machine-readable results. A skipped, blocked, stale-SHA, or
partially completed workflow is not release evidence.

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

The current Compose retry candidate for ClamAV is `clamav/clamav:1.5-debian`.
The current PostgreSQL/PostGIS retry candidate is
`ghcr.io/enterprisedb/postgresql:17.7-3.5-postgis-3-multilang`.
The timeout against `clamav/clamav:1.4.3` recorded below is historical evidence
and is intentionally retained unchanged.

Development status (2026-08-11): **A02 Complete**. Native and local Compose
checks are recorded in [the A02 Gate report](../reports/a02-native-gate.md).
This release checklist remains open because its target is clean CI/staging
Compose parity and release evidence, not only a local Docker Desktop run.

Any unchecked item blocks release. Native Track evidence cannot waive this
gate.

### Historical handoff — 2026-07-28

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
- The next retry should use the multi-platform candidate
  `clamav/clamav:1.5-debian`.
- No Compose readiness, persistence, EICAR, or parity item above is considered
  passed by this partial pull.

### Pull retry — 2026-08-11

- On macOS arm64 with Docker Compose v5.2.0, the explicit command
  `docker compose -f infra/compose/docker-compose.yml pull redis minio minio-init clamav`
  completed successfully.
- Redis, MinIO, MinIO client, and `clamav/clamav:1.5-debian` were pulled; the
  PostgreSQL/PostGIS service was intentionally excluded from the command.
- A subsequent pull of `imresamu/postgis:17-3.5-bookworm` did not complete:
  Docker Desktop's configured mirror returned `403 Forbidden`, and a direct
  retry against `registry-1.docker.io` hit a TLS handshake timeout.
- Compose startup was not attempted because the PostgreSQL/PostGIS image was
  not available locally.
- This validates image resolution/download only. Compose readiness, persistence,
  EICAR detection, and full parity remain unchecked.

### Pull retry after mirror change — 2026-08-11

- Docker Desktop now reports no configured registry mirrors (`mirrors=[]`).
- Both `docker compose ... pull postgres` and a direct
  `docker pull docker.io/imresamu/postgis:17-3.5-bookworm` retry reached
  `registry-1.docker.io` but failed with a TLS handshake timeout.
- The PostgreSQL/PostGIS image is still absent locally, so Compose startup
  remains intentionally deferred.

### GHCR PostgreSQL/PostGIS retry — 2026-08-11

- The Compose candidate was changed to
  `ghcr.io/enterprisedb/postgresql:17.7-3.5-postgis-3-multilang`.
- Its manifest includes both `linux/amd64` and `linux/arm64`; the ARM64 image
  pulled successfully from GHCR with digest
  `sha256:ecb0a998596f16d9f4d3c542c34b09e0812444cb05a5e2f0cb2f7e579274458a`.
- A fresh named-volume probe using the Compose `POSTGRES_*` variables and
  `infra/compose/init/postgres` completed initialization. `pg_isready` passed
  and `PostGIS_Full_Version()` reported PostgreSQL 17/PostGIS 3.5.2.
- The image defaults to `PGDATA=/var/lib/postgresql/data/pgdata`; existing
  data volumes created with a root-level PostgreSQL data directory require a
  planned migration rather than an in-place image swap.

### Compose stack retry — 2026-08-11

- The complete `docker compose ... pull` command resolved the GHCR PostgreSQL,
  Quay MinIO, and Redis images, but still exited non-zero when Docker Hub
  timed out while checking `clamav/clamav:1.5-debian`. The ClamAV image was
  already present locally from the successful earlier pull, so startup used
  the local cache; a clean-machine all-image pull remains an open item.
- The Native Track was already using the standard ports from
  `infra/local-stack.env`. Compose was started with temporary loopback ports
  `25432`, `26379`, `29000`, `29001`, and `23310`; the env file and Native
  Track were not changed or stopped.
- `postgres`, `redis`, `minio`, and `clamav` reached `healthy`; the second
  `minio-init` run exited `0`, confirming bucket initialization is idempotent.
- The shared Compose health probe passed PostGIS, authenticated Redis,
  MinIO, and ClamAV. PostgreSQL restart, Redis AOF restart, and MinIO object
  round-trip restart checks all retained data.
- The exact 68-byte EICAR sample returned `Eicar-Test-Signature FOUND`. Stopping
  ClamAV made the shared health probe fail with `clamav: not ready`; restarting
  it restored `Local stack: Compose Ready`.
- These local checks advance Compose readiness and persistence evidence, but
  release CI/staging parity, default-port startup, and clean-network pull
  evidence remain unchecked.
- The local evidence closes the development-stage A02 gate; all checklist boxes
  above remain release obligations and are intentionally not marked complete.

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

Run the manual `Release Gates` workflow for the immutable release candidate.
The A05 job uses the protected `staging` environment and fails closed unless
all exact HTTPS metadata, the external client Secret, Redis identity store,
and a committed provider-specific real-flow driver are configured. A workflow
run that is skipped, blocked, or failed is not release evidence.

### Current handoff — 2026-07-29

- Status: deferred to staging/release validation; this does not block the
  current A05 development gate once its Dev Track passes.
- OIDC provider, staging origin, issuer, client registration, and staging
  Secret have not yet been supplied or validated.
- No real callback, HTTPS Cookie, provider logout, external Secret rotation, or
  staging outage item above is considered passed.
