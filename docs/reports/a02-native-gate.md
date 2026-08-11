# A02 development gate

Date: 2026-07-28
Native environment: macOS arm64, loopback-only isolated test ports
Compose verification: macOS arm64 Docker Desktop, temporary loopback-only ports

## Versions

- PostgreSQL 17.10
- PostGIS 3.6.4
- Redis 8.8.1
- MinIO `RELEASE.2025-10-15T17-29-55Z`
- MinIO Client `RELEASE.2025-08-13T08-35-41Z`
- ClamAV 1.5.3

## Result

`A02 Complete` for the current development stage. Native Track evidence is
complete, and the later local Compose verification is recorded below. The
separate CI/staging release parity gate remains open.

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

## Compose handoff and evidence history

The entries in this section preserve the original blocked attempts. They are
historical evidence, not the final local Compose status. The release-only
items remain tracked in [the release checklist](../runbooks/release-checklist.md).

Compose was first attempted after the Native gate. Docker Desktop and Compose
were reachable, but the image pull stopped on a Docker Hub TLS handshake
timeout for the ClamAV image. No fallback or retry was used at that point.

The next Compose retry candidates are
`ghcr.io/enterprisedb/postgresql:17.7-3.5-postgis-3-multilang` for
PostgreSQL/PostGIS and `clamav/clamav:1.5-debian` for ClamAV; the historical
`clamav/clamav:1.4.3` timeout is retained above as evidence of the original
attempt.

On 2026-08-11, an explicit pull of Redis, MinIO, MinIO client, and
`clamav/clamav:1.5-debian` completed successfully on the macOS arm64 Docker
Desktop. PostgreSQL/PostGIS was intentionally excluded; this was a pull-only
check and did not pass Compose readiness or parity items.

The follow-up pull of `imresamu/postgis:17-3.5-bookworm` was blocked by the
Docker Desktop registry path: the configured mirror returned `403 Forbidden`,
and a direct `registry-1.docker.io` retry ended in a TLS handshake timeout.
Compose startup was therefore not attempted at that historical checkpoint.

After the mirror was removed on 2026-08-11 (`mirrors=[]`), both Compose and a
direct Docker Hub retry still failed with a TLS handshake timeout. The image is
not present locally at that historical checkpoint, so the Compose Track was
still deferred at that point.

The PostgreSQL/PostGIS candidate was then moved to
`ghcr.io/enterprisedb/postgresql:17.7-3.5-postgis-3-multilang`. Its manifest
contains `linux/amd64` and `linux/arm64`; the ARM64 pull from GHCR succeeded.
A fresh named-volume probe with the Compose environment and initialization
script reached readiness and returned PostGIS 3.5.2. At that point the full
stack restart/persistence checks were still pending; the completed checks are
recorded in the closure addendum below.

The complete Compose stack was subsequently started on 2026-08-11 using the
GHCR PostgreSQL image and the locally cached ClamAV image. Native Track already
occupied the standard local ports, so the Compose run used temporary loopback
ports and did not modify or stop Native Track. The detailed readiness,
persistence, EICAR, and fail-closed results are recorded in the closure
addendum below. A clean-machine pull of all images is still blocked by the
Docker Hub ClamAV TLS timeout, so release CI/staging parity remains open.

## A02 closure addendum — 2026-08-11

The development-stage A02 gate is closed. The complete local Compose stack was
started with the GHCR PostgreSQL image and locally cached ClamAV image because
the Docker Hub ClamAV manifest check continued to time out. Native Track was
left running; Compose used temporary loopback ports to avoid a port collision.

Evidence completed:

- PostgreSQL 17.7/PostGIS 3.5.2, Redis, MinIO, and ClamAV all reached healthy
  state;
- the shared Compose probe passed PostGIS, authenticated Redis, MinIO, and
  ClamAV readiness;
- the second MinIO initializer exited successfully, proving idempotent bucket
  initialization;
- PostgreSQL, Redis AOF, and MinIO object data survived service restarts;
- the exact 68-byte EICAR fixture returned `Eicar-Test-Signature FOUND`;
- stopping ClamAV made readiness fail closed, and restarting it restored a
  ready stack.

This closes A02 for current development and unblocks the next milestone. It
does not close the production-release A02 Compose parity checklist: a clean
CI/staging pull of every pinned image, release-SHA evidence, and formal parity
artifacts are still required.
