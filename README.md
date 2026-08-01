# On The Road

On The Road is a travel-planning platform built as a pnpm monorepo. It combines
a Next.js Web application, a NestJS/Fastify API, BullMQ workers, PostgreSQL with
PostGIS, Redis, S3-compatible object storage, and ClamAV.

## Project status

M0, M1, and M2 are complete for the **Dev Track**. The repository currently
includes:

- runnable Web, API, Worker, and PDF Worker processes;
- development identity and production OIDC release guards;
- Trip, Day, and itinerary-item persistence with optimistic concurrency;
- owner-scoped Location search, candidate confirmation, and coordinate editing;
- secure attachment intake and image processing;
- expenses, exchange rates, and safe Excel inspection;
- a generated OpenAPI client and real HTTP route-parity tests;
- a real API → PostgreSQL → Redis/BullMQ → Worker smoke test;
- desktop and mobile Playwright coverage against the production composition
  root.

The post-M2 P0/P1 findings are closed at their documented maturity level. M3
feature work has not been declared complete. Dev Track completion is also not
production approval: full Compose parity and a real Staging IdP remain mandatory
release gates.

See [CODE_REVIEW](./docs/CODE_REVIEW.md) for remediation evidence and
[the M2 Gate report](./docs/reports/m2-gate.md) for the milestone boundary.

## Repository layout

| Path | Purpose |
|---|---|
| `apps/web` | Next.js and React product UI |
| `apps/api` | NestJS/Fastify HTTP API and composition root |
| `apps/worker` | BullMQ application and media/import workers |
| `apps/pdf-worker` | Dedicated PDF queue process |
| `packages/contracts` | OpenAPI contract and generated client |
| `packages/database` | Pooled PostgreSQL access, migrations, status, and seed |
| `packages/domain` | Domain invariants and value models |
| `packages/providers` | HERE, AMAP, hybrid, and fixture Provider adapters |
| `docs` | Design, development plan, Test Cases, reports, ADRs, and runbooks |

## Toolchain

- Node.js `24.14.0`
- pnpm `9.15.4`

```sh
pnpm install --frozen-lockfile
pnpm run toolchain:check
```

The versions are enforced by the repository. Do not treat an engine warning
from another Node version as a supported development environment.

## Local development

Daily macOS development uses the native dependency track and does not require
Docker. The stack provides PostgreSQL/PostGIS, Redis, MinIO, and ClamAV:

```sh
bash scripts/dev-up.sh --track native
bash scripts/dev-up-health.sh --track native
```

The startup command applies migrations, seeds reference data, checks schema
compatibility, initializes object storage, and waits for fail-closed readiness.
It never installs missing system software automatically.

To build and start the four application processes, export the local dependency
contract and the development application settings:

```sh
set -a
source infra/local-stack.env
set +a

export NODE_ENV=development
export APP_ORIGIN=http://localhost:3000
export API_BASE_URL=http://localhost:3001/api/v1
export NEXT_PUBLIC_API_ORIGIN=http://localhost:3001
export OBJECT_STORAGE_ENDPOINT="$S3_ENDPOINT"
export OBJECT_STORAGE_REGION="$S3_REGION"
export OBJECT_STORAGE_ACCESS_KEY="$S3_ACCESS_KEY"
export OBJECT_STORAGE_SECRET_KEY="$S3_SECRET_KEY"
export OBJECT_STORAGE_BUCKET="$MINIO_BUCKET"
export SESSION_SECRET=local-session-secret-change-me-32-bytes
export MAP_PROFILE=fixture
export MAP_AUTOCOMPLETE_ENABLED=false
export MAP_EXPLICIT_SEARCH_ENABLED=false

pnpm run build
```

Then run these commands in separate shells with the same environment:

```sh
pnpm run start:api
pnpm run start:web
pnpm run start:worker
pnpm run start:pdf-worker
```

The Web application is available at `http://localhost:3000`. API liveness and
readiness are exposed at `http://localhost:3001/health/live` and
`http://localhost:3001/health/ready`.

Stop the dependency stack while preserving its project-scoped data:

```sh
bash scripts/dev-down.sh --track native
```

For prerequisites, recovery behavior, and the Compose track, use the
[local stack runbook](./docs/runbooks/local-stack.md).

## Database lifecycle

Native development, Compose, CI, staging, and production use the same migration
entry point:

```sh
pnpm run db:migrate
pnpm run db:seed
pnpm run db:status -- --check --json
```

Migration history records versions, checksums, timestamps, and failure state.
Checksum drift, unknown versions, dirty migrations, or an incompatible schema
fail readiness. Recovery is explicit; the runner never silently marks a failed
migration as complete.

## Quality and tests

```sh
# Required-Case/document consistency plus lint, typecheck, unit tests, and build
pnpm run quality

# Clean-checkout and frozen-install smoke
pnpm run ci:smoke

# Full local equivalent of the push checks
pnpm run ci:local
```

`pnpm run ci:local` must run from a clean, committed worktree. It verifies the
current SHA, provisions the dependency stack, applies and checks migrations,
and executes every required M0–M2 Vitest, `node:test`, and Playwright Case
without skips. Diagnostics are written to
`test-results/local-m0-m2-required.json`.

The local aggregate Gate requires Docker Compose v2, Playwright Chromium,
Poppler, ImageMagick, `redis-cli`, and the pinned native `minio`/`mc` test
binaries. Daily application development can still use the Docker-free native
track.

GitHub runs:

- `CI-Quality Related` for static quality and build checks;
- `CI-Test Cases` for the dependency-backed required Cases and runtime smoke;
- `Release Gates` for protected Compose and real-IdP release evidence.

## Map profiles

`MAP_PROFILE=fixture` is the key-free default and never calls a public map
service. Online profiles are constructed during API startup and fail closed
when required credentials are absent:

- `cn_primary` — AMAP with `AMAP_API_KEY`;
- `international_primary` — HERE with `OTR_HERE_API_KEY`;
- `hybrid` — both keys, with deterministic Provider selection.

AMAP coordinates are converted from GCJ-02 to the WGS84 domain model. Provider
failures never trigger silent fallback or rewrite a Trip's selected profile.
Keys remain server-side. No HERE App ID is used.

## Release boundary

Dev and release verification intentionally use separate tracks:

- **Dev Gate:** native macOS services, fixture Providers, development
  identity/Mock OIDC, required Cases, and real local runtime smoke.
- **Release Gate:** Linux/Compose parity, persistence and recovery, resource
  limits, malware fail-closed behavior, HTTPS cookies, and a real Staging IdP.

Open items in [the release checklist](./docs/runbooks/release-checklist.md)
cannot be waived by a green Dev Gate.

## Documentation

- [Product and technical design](./docs/DESIGN.md)
- [Development plan and Task ownership](./docs/DEVELOPMENT_PLAN.md)
- [Test Cases and Gate rules](./docs/TEST_CASES.md)
- [Code review and remediation ledger](./docs/CODE_REVIEW.md)
- [Local dependency runbook](./docs/runbooks/local-stack.md)
- [Release checklist](./docs/runbooks/release-checklist.md)
