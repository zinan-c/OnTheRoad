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
