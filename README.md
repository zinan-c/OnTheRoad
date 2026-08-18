# On The Road

On The Road is a travel-planning platform built as a pnpm monorepo. It combines
a Next.js Web application, a NestJS/Fastify API, BullMQ workers, PostgreSQL with
PostGIS, Redis, S3-compatible object storage, and ClamAV.

## Project status

M0 through M3 are complete for the **Dev Track**. M4 is complete for its
current E06–E09, F01–F03, F05 scope and its Dev Track Gate is closed; production
release gates remain separate. The repository currently
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

The current post-M4 map decision removes HERE from the active architecture:
`international_primary` uses public online Nominatim through the API proxy,
`hybrid` uses AMAP in China and Nominatim overseas, and `dev`/`qa`/`prod` use
online map runtime by default. CI keeps the explicit `fixture` profile for
deterministic tests. The current decision and remaining online Directions gate
are recorded in [`ADR-003`](./docs/adr/003-online-nominatim-map-runtime.md) and
the [online map migration plan](./docs/reports/nominatim-online-plan.md).

Use the [documentation status index](./docs/README.md) as the canonical current
status entry point. Detailed evidence is in the [current code review](./docs/reviewer/CODE_REVIEW_0818.md),
the [historical remediation ledger](./docs/reviewer/CODE_REVIEW.md),
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
| `packages/providers` | Nominatim, AMAP, hybrid, and fixture Provider adapters (target architecture) |
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

本地开发属于 `dev` 运行时：应用默认通过 API proxy 使用公共在线 Nominatim，
不启动本地 Nominatim 数据库。只有 CI、离线回归或确定性测试才显式设置
`MAP_PROFILE=fixture`；瓦片和 Directions 仍按独立在线 endpoint 配置。

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
current full SHA, provisions the real Compose/PostgreSQL/Redis/MinIO/ClamAV
stack, applies and checks migrations, starts the API, Web, Worker, and PDF
Worker, and executes every required M0–M4 Case plus the required 22-case
product-browser suite without skips. The Gate rejects dirty, wrong-commit,
failed, skipped, todo, or uncollected evidence. Diagnostics are written to
`test-results/local-m0-m4-required.json`; product E2E JSON/JUnit, browser
artifacts, HTML, and commit-bound `product-e2e-evidence.json` are retained in
`test-results/` and verified by the corresponding evidence commands.

The local aggregate Gate requires Docker Compose v2, Playwright Chromium,
Poppler, ImageMagick, `redis-cli`, and the pinned native `minio`/`mc` test
binaries. Daily application development can still use the Docker-free native
track.

GitHub runs:

- `CI-Quality Related` for static quality and build checks;
- `CI-Test Cases` for the dependency-backed required Cases and runtime smoke;
- `Release Gates` for protected Compose and real-IdP release evidence.

## Map profiles

`MAP_PROFILE=fixture` is the explicit offline/CI profile and never calls a
public map service. Local development uses the `dev` online map runtime;
`dev`/`qa`/`prod` use online map runtime by default;
online profiles are constructed during API startup and fail closed when the
required endpoint/configuration is absent:

- `cn_primary` — AMAP with `AMAP_API_KEY`;
- `international_primary` — public Nominatim through the API proxy;
- `hybrid` — AMAP in China and public Nominatim overseas.

AMAP coordinates are converted from GCJ-02 to the WGS84 domain model. Provider
failures never trigger silent fallback or rewrite a Trip's selected profile.
Nominatim requests use a stable application User-Agent/contact, cache and
application-wide rate limit; its public API is explicit-search only. Tiles and
Directions are independently configured online capabilities, not Nominatim
capabilities. Keys and endpoint details remain server-side.

## Release boundary

Dev and release verification intentionally use separate tracks:

- **Dev/QA runtime:** native/Compose/remote dependencies with online
  Nominatim, tiles and independent Directions configured; controlled online
  smoke is separate from deterministic fixture tests.
- **CI/Dev Gate:** explicit fixture Providers, development identity/Mock OIDC,
  required Cases, and real local runtime smoke; CI never calls public maps.
- **Release Gate:** Linux/Compose parity, persistence and recovery, online map
  smoke/attribution/rate-limit checks, resource limits, malware fail-closed
  behavior, HTTPS cookies, and a real Staging IdP.

Open items in [the release checklist](./docs/runbooks/release-checklist.md)
cannot be waived by a green Dev Gate.

## Documentation

- [Current milestone and evidence status](./docs/README.md)
- [Product and technical design](./docs/DESIGN.md)
- [Development plan and Task ownership](./docs/DEVELOPMENT_PLAN.md)
- [Milestone acceptance plan](./docs/DEVELOPMENT_MILESTONE.md)
- [Execution and handoff plan](./docs/DEVELOP_EXECUTION_PLAN.md)
- [Test Cases and Gate rules](./docs/TEST_CASES.md)
- [Current code review (2026-08-18)](./docs/reviewer/CODE_REVIEW_0818.md)
- [Post-M2 code review and remediation ledger](./docs/reviewer/CODE_REVIEW.md)
- [Configuration reference](./docs/configuration.md)
- [Observability baseline](./docs/observability.md)
- [Local dependency runbook](./docs/runbooks/local-stack.md)
- [Release checklist](./docs/runbooks/release-checklist.md)
