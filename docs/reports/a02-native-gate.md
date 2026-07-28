# A02 Native development gate

Date: 2026-07-28
Environment: macOS arm64, loopback-only isolated test ports

## Versions

- PostgreSQL 17.10
- PostGIS 3.6.4
- Redis 8.8.1
- MinIO `RELEASE.2025-10-15T17-29-55Z`
- MinIO Client `RELEASE.2025-08-13T08-35-41Z`
- ClamAV 1.5.3

## Result

`A02 Complete` for the current development stage.

The final Native Track gate passed 3 test files and 11 tests. It covered:

- deterministic preflight and unsafe runtime rejection;
- isolated first start and idempotent second start;
- PostgreSQL/PostGIS readiness;
- authenticated Redis readiness and AOF persistence;
- S3-compatible bucket initialization and put/get;
- ClamAV TCP readiness and EICAR detection;
- PostgreSQL, Redis, and MinIO data retention across restart;
- ClamAV outage causing fail-closed readiness;
- PID ownership checks that do not terminate unrelated processes.

The initial sandboxed run failed because PostgreSQL could not allocate System V
shared memory. The same fixed command was rerun outside the sandbox, where
implementation defects and test races were fixed before the final passing run.

## Compose handoff

Compose was attempted after the Native gate. Docker Desktop and Compose were
reachable, but the image pull stopped on a Docker Hub TLS handshake timeout for
the ClamAV image. No fallback or retry was used. All Compose parity items remain
open in [the release checklist](../runbooks/release-checklist.md).
