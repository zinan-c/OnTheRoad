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
  fail-closed cases pass, and the current Compose attempt has either produced
  evidence or an actionable release-checklist handoff.
- `Release Ready`: the Compose parity/release gate passes in CI or staging.

`A02 Complete` unblocks current development. It is not release evidence when
the Compose handoff remains open.

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

All endpoints bind to loopback in Native Track. Example credentials are
non-default, local-only values and must never be reused in staging or
production.

## Native Track (default on macOS)

### Prerequisites

- Node 24 and pnpm 9.15.4, as pinned at the repository root.
- Compatible native installations of PostgreSQL/PostGIS, Redis, MinIO client
  and server, and ClamAV.
- Enough disk space for project-local database/object/signature data.

The implementation must check versions before starting. Missing or incompatible
binaries produce actionable output; the script must not install or upgrade
software automatically.

### Commands

```sh
bash scripts/dev-up.sh --track native
bash scripts/dev-up-health.sh --track native
bash scripts/dev-down.sh --track native
```

The start command will:

1. create an ignored, project-scoped runtime directory;
2. allocate only configured loopback ports;
3. start or discover only processes owned by this project;
4. initialize PostGIS and the S3 bucket idempotently;
5. wait for the shared readiness probes;
6. print `Local stack: Native Ready`.

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
bash scripts/dev-up.sh --track compose
bash scripts/dev-up-health.sh --track compose
bash scripts/dev-down.sh --track compose
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
