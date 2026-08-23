# Local dependency stack (dual track)

The local stack provides PostgreSQL/PostGIS, Redis, S3-compatible object
storage, and ClamAV. It has two tracks with one application-facing contract:

- **Native Track** is the default for macOS development and does not require a
  container runtime.
- **Compose Track** runs in CI/staging and before releases to verify Linux,
  service-network, persistence, resource-limit, and failure-recovery behavior.

Applications receive only URLs, credentials, and capability/readiness results.
They must not branch on the selected track.

## Completion states

- `Native Ready`: the native services pass the shared health probes.
- `A02 Complete`: Native Track bootstrap, restart/recovery, persistence, and
  fail-closed cases pass, and the current Compose attempt has produced evidence
  or an actionable release-checklist handoff.
- `Release Ready`: the Compose parity/release gate passes in CI or staging.

Current status (2026-08-11): **A02 Complete**. Native Track and local Compose
evidence are recorded in [the A02 Gate report](../reports/a02-native-gate.md).
This unblocks current development; it does not close the CI/staging
Compose/Linux release gate in [the release checklist](./release-checklist.md).

## Shared contract

Both tracks use `infra/local-stack.env`, generated from the committed,
secret-free `infra/local-stack.env.example`. The contract includes:

- PostgreSQL URL and a migration that enables `postgis`;
- authenticated Redis URL;
- S3 endpoint, region, bucket, access key, secret key, and path-style setting;
- ClamAV TCP host/port and `CLAMAV_REQUIRED=true`;
- stable readiness output and exit codes.

Initialization must be idempotent in both tracks. Database changes go through
the same migration entrypoint, and bucket creation uses the same initializer.
No application code may depend on a Homebrew path, Unix socket, PID file,
Docker socket, or Compose service name.

## Online map runtime

The local dependency stack does not run a map database. For the production-
shaped China profile, set `MAP_PROFILE=cn_primary` and provide official AMap
credentials. CI and deterministic local tests explicitly use `fixture` and
must not access the network.

- `AMAP_API_KEY` stays in API/Worker/PDF Worker environment variables and is
  used for official AMap Web Service Search/Reverse, Directions and Static Map.
- `AMAP_JS_API_KEY` and `AMAP_JS_SECURITY_CODE` are public browser runtime
  values delivered only by same-origin `/api/map/config`; the endpoint never
  serializes `AMAP_API_KEY`.
- `OTR_AMAP_TIMEOUT_MS`, `OTR_AMAP_RATE_LIMIT_RPS` and
  `OTR_AMAP_CACHE_TTL_SECONDS` apply to Search/Reverse independently of the
  Directions/PDF timeouts.
- `OTR_DIRECTIONS_BASE_URL` must be the official AMap Directions base URL in
  `cn_primary`; `OTR_STATIC_MAP_BASE_URL` must be the official AMap Static Map
  endpoint. Both require visible `© 高德地图` attribution.
- `OTR_MAP_DEFAULT_LAYER` selects only `amap-street`, `amap-satellite` or
  `amap-satellite-labels`. No public OSM tile, undocumented AMap tile host,
  Geoapify or silent online fallback is allowed in `cn_primary`.
- AMap errors are reported as unavailable/degraded; they do not mutate the
  profile or substitute fixture geometry. PDF fallback retains markers,
  routes, attribution and a manifest degradation reason.
- `fixture` uses deterministic local Search/Reverse/Directions/Static Map and
  the local raster route; its tests run with zero network calls.

Online map readiness is separate from PostgreSQL/Redis/MinIO/ClamAV readiness.
The shared application readiness output reports the actual configured map,
geocoding, reverse geocoding, Directions and Static Map capability states
without logging query text, address content, coordinates or provider secrets.

All endpoints bind to loopback in Native Track. Example credentials are
non-default, local-only values and must never be reused in staging or
production.

## Native Track (default on macOS)

### Prerequisites

- Node 26.0.0 and pnpm 9.15.4, as pinned at the repository root.
- Compatible native installations of PostgreSQL/PostGIS, Redis, MinIO client
  and server, and ClamAV.
- Enough disk space for project-local database/object/signature data.

The implementation must check versions before starting. Missing or incompatible
binaries produce actionable output; the script must not install or upgrade
software automatically.

### Commands

```sh
pnpm run dev:prepare
pnpm run stop
```

`pnpm run dev` uses Native dependencies by default. Select the dependency
track explicitly with `pnpm run dev -- -native` or
`pnpm run dev -- -compose`; `-componse` is accepted as a compatibility alias.
After API, Web, and Worker readiness succeeds, the command prints the current
Web URL and API live/ready/base URLs.

The start command will:

1. create an ignored, project-scoped runtime directory;
2. allocate only configured loopback ports;
3. start or discover only processes owned by this project;
4. initialize PostGIS and the S3 bucket idempotently;
5. run the shared readiness probes;
6. run the shared `db:migrate`, `db:seed`, and `db:status --check` entrypoint;
7. write the generated profile only after those checks succeed;
8. print `Environment prepared`.

`pnpm run dev` invokes this prepare phase, builds the API, Web, and Worker,
starts them with the generated profile, and waits for API, Web, and Worker
heartbeat readiness. `pnpm run qa` uses the same flow and can select Compose
with `OTR_QA_TRACK=compose`. Production validates injected `OTR_ENV_*` values
only; it does not start local dependencies or write a profile.

`pnpm run stop` first stops the recorded API, Worker, and Web process trees,
then stops the project-managed Native dependencies. It preserves PostgreSQL
and object-storage data. Use `pnpm run stop compose` when the Compose Track is
running; it stops the same application process trees and the Compose services,
releasing the published dependency ports without removing named volumes.

PID files must record both PID and an ownership fingerprint. Stop/recovery must
verify that fingerprint before signaling a process, so stale PID files cannot
terminate an unrelated service. Logs and data remain project-scoped. A
preserve-data stop is the default; destructive cleanup requires a separate,
explicitly confirmed command.

The health command verifies:

- `SELECT 1 FROM pg_extension WHERE extname = 'postgis'`;
- authenticated Redis returns exactly `PONG`;
- an S3 put/get round trip succeeds in the configured bucket;
- ClamAV accepts a TCP ping.

Readiness is fail-closed: if ClamAV is required but unavailable, health exits
non-zero and media processing must not start.

## Compose Track (CI/staging and release verification)

### Prerequisites

- A supported container engine and Compose v2 in the CI/staging environment.
- At least 4 GB available to the stack; ClamAV signature initialization is
  expected to be the slowest readiness step.

### Commands

```sh
bash scripts/prepare-environment.sh qa compose
# Stack-only shutdown:
bash scripts/dev-down.sh --track compose
# Application and stack shutdown:
pnpm run stop compose
```

Compose uses short-lived volumes for clean-start cases and named volumes for
restart/persistence cases. Published development ports remain loopback-only.
The release gate must additionally verify:

- Linux image architecture and pinned versions;
- service DNS and TCP-only dependency access;
- non-root/read-only boundaries where applicable;
- memory/CPU limits;
- retained PostgreSQL, Redis, and S3 data after service restart;
- EICAR is reported as infected;
- stopping ClamAV makes shared readiness fail closed.

The current environment must attempt this track once. If the container engine
is unavailable, preserve the exact failure and move the remaining assertions to
the release checklist. CI/staging must publish the eventual test result and
version/image metadata before release.

## Parity gate

The two tracks execute the same probe implementation and fixture. Parity is
defined at the contract boundary, not by identical process-management details:

- the same environment variable schema is accepted;
- the same migrations and bucket initializer are used;
- the same capabilities become ready or degraded;
- the same PostGIS, Redis, S3, and ClamAV operations succeed or fail;
- error output does not reveal credentials.

A parity failure caused by an available but behaviorally incompatible stack
blocks A02 and requires a fix. A documented container-environment availability
failure may be handed off, but continues to block `Release Ready`. It must not
be bypassed by replacing a real dependency with a mock.

## Database schema lifecycle

Native, Compose, CI, staging, and production use the same commands. The
connection string is read only from `DATABASE_URL`; it is never accepted as a
CLI argument.

```sh
pnpm run db:migrate
pnpm run db:seed
pnpm run db:status -- --check --json
```

Each migration records its version, expanded-SQL SHA-256 checksum, start time,
completion time, and state in `otr_schema_migration`. Applied checksum drift,
unknown versions, dirty state, and a schema below the minimum compatible
version fail the status/readiness gate. A failed or interrupted transaction
must be inspected before an explicit `pnpm run db:migrate -- --recover`; the
runner does not silently mark it complete. Migration SQL is transactional, and
the advisory lock prevents two deployers from migrating concurrently.

Production deployment runs migration as a one-shot pre-deploy job, then starts
applications only after `db:status --check` succeeds. Application replicas do
not race to migrate during startup.

## Troubleshooting policy

- Missing native binary or version mismatch: print the detected and required
  versions; wait for explicit approval before any download/install.
- Port already in use: identify the port and owning process; do not terminate
  it automatically.
- Stale PID: verify ownership fingerprint, repair project state, and leave
  unrelated processes untouched.
- ClamAV not ready: report signature/daemon status; do not disable scanning.
- Bucket already exists: treat idempotent creation as success only after an
  authenticated read/write probe.
- Compose unavailable in the current development environment: record the exact
  failure in the release checklist and continue only after Native Track passes.
- Compose unavailable or failing in CI/staging before release: fail the release
  gate; do not reinterpret a Native Track result as Compose evidence.
