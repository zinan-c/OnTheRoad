# On The Road

On The Road is a travel-planning platform built as a pnpm monorepo. It combines
a Next.js Web application, a NestJS/Fastify API, BullMQ workers, PostgreSQL with
PostGIS, Redis, S3-compatible object storage, and ClamAV.

## Project status

M0 through M3 are complete for the **Dev Track**. M4 implementation is complete
for its current E06–E09, F01–F03, F05 scope, while the M4 Dev Track Gate remains
open pending the real-stack required-case run. The repository currently
includes:

- runnable Web, API, Worker, and PDF Worker processes;
- development identity and production OIDC release guards;
- Trip, Day, and itinerary-item persistence with optimistic concurrency;
- owner-scoped Location search, candidate confirmation, and coordinate editing;
- generation-safe routing, map/timeline interaction, and explicit degraded
  route presentation;
- secure attachment intake, image processing, and gallery management;
- expenses, exchange rates, multidimensional summaries, and safe Excel
  staging/preview isolation;
- a generated OpenAPI client and real HTTP route-parity tests;
- a real API → PostgreSQL → Redis/BullMQ → Worker smoke test;
- desktop and mobile Playwright coverage against the production composition
  root.

The post-M2 P0/P1 findings and the M3 closure review are closed at their
documented Dev maturity level. Dev Track completion is not production approval:
full Compose/Linux parity, a real Staging IdP, and the remaining protected
release checks remain mandatory release gates.

Use the [documentation status index](./docs/README.md) as the canonical current
status entry point. Detailed evidence is in [CODE_REVIEW](./docs/CODE_REVIEW.md),
the [M3 Gate report](./docs/reports/m3-gate.md), the
[M4 Gate report](./docs/reports/m4-gate.md), the
[Product acceptance record](./docs/reports/m3-product-acceptance.md), and the
[final R&D review](./docs/reports/m3-rnd-final-review.md).

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

- Node.js `26.0.0`
- pnpm `9.15.4`

```sh
pnpm install --frozen-lockfile
pnpm run toolchain:check
```

The versions are enforced by the repository. Do not treat an engine warning
from another Node version as a supported development environment.

## Local development

Daily macOS development uses the native dependency track and does not require
Docker. The startup flow is:

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

`pnpm run dev` defaults to the Native dependency track. Select the dependency
environment explicitly with `-native` or `-compose` (the historical
`-componse` spelling is accepted as an alias):

```sh
pnpm run dev -- -native
pnpm run dev -- -compose
```

`pnpm run dev` first runs the prepare phase. Prepare starts or adopts the
project-owned PostgreSQL/PostGIS, Redis, MinIO, and ClamAV services, waits for
fail-closed readiness, applies migrations and seed data, checks schema
compatibility, writes the generated `config/profiles/dev.env`, and only then
starts the API, Web, and Worker. It retries dependency startup three times and
stops on any failed prerequisite. It never installs missing system software
automatically.

To run only the dependency and database preparation checks:

```sh
pnpm run dev:prepare
```

Profile entry points:

```sh
# Native QA track (default)
pnpm run qa

# Compose QA track, when container verification is intended
OTR_QA_TRACK=compose pnpm run qa

# Production: validate injected OTR_ENV_* only; do not start local services
pnpm run prod
```

`dev` and `qa` use the same prepare → profile → build → application readiness
chain. `prod` validates injected `OTR_ENV_*` values and does not start local
dependencies or write a profile.

When the application is ready, `pnpm run dev` prints the current Web URL and
API live/ready/base URLs. The Web and API ports are selected from the project
defaults (`18100`/`18101`) and move together to the next free pair when needed.

Stop the API, Worker, Web application, and the selected dependency stack while
preserving project-scoped data. Native is the default; pass `compose` to stop
the Compose services and free their published ports before starting Native:

```sh
# Native Track (default)
pnpm run stop

# Compose Track
pnpm run stop compose
```

Shutdown only signals processes whose PID, start time, and command fingerprint
were recorded by this repository; it does not terminate arbitrary port owners.

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
current full SHA, provisions the dependency stack, applies and checks
migrations, starts the real API and Worker, and executes every required M0–M4
Vitest, `node:test`, and Playwright Case without skips. The Gate rejects dirty,
wrong-commit, failed, skipped, todo, or uncollected evidence. Diagnostics are
written to `test-results/local-m0-m4-required.json` and validated by
`pnpm run test:cases:evidence`.

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

- [Current milestone and evidence status](./docs/README.md)
- [Product and technical design](./docs/DESIGN.md)
- [Development plan and Task ownership](./docs/DEVELOPMENT_PLAN.md)
- [Milestone acceptance plan](./docs/DEVELOPMENT_MILESTONE.md)
- [Execution and handoff plan](./docs/DEVELOP_EXECUTION_PLAN.md)
- [Test Cases and Gate rules](./docs/TEST_CASES.md)
- [Code review and remediation ledger](./docs/CODE_REVIEW.md)
- [Configuration reference](./docs/configuration.md)
- [Observability baseline](./docs/observability.md)
- [Local dependency runbook](./docs/runbooks/local-stack.md)
- [Release checklist](./docs/runbooks/release-checklist.md)
