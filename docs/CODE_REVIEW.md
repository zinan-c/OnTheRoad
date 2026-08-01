# On The Road Code Review

> Review point: after the M2 closure
>
> Review scope: all documentation under `docs/`, all current applications and shared packages, tests, build scripts, infrastructure, and runtime configuration.
>
> Review type: read-only assessment for follow-up agents to claim, remediate, and verify. It does not indicate that any remediation has been implemented.

## Remediation status

This report preserves the findings as they existed at the review point. Current
closure evidence is recorded here rather than rewriting the original evidence.

| Finding | Dev status | Closure evidence |
|---|---|---|
| P0-01 | Closed | `tests/runtime/real-stack.e2e.spec.ts` starts the real API composition root against migrated PostgreSQL and Redis, persists Trip/Item/Location/upload-entry changes over HTTP, sends the reorder outbox event through BullMQ, and proves the Worker writes the inbox receipt and handled timestamp. The production Worker rejects `runtime.noop` and uses an explicit PostgreSQL event processor. |
| P1-03 | Closed | Every non-test OpenAPI operation is mounted on the Nest/Fastify application; route parity and generated-client success/Problem Details are exercised by `apps/api/test/runtime/public-route-parity.e2e.spec.ts`. |
| P1-04 | Closed for the M0–M2 Dev scope | Playwright starts the production API composition root rather than an in-memory repository. `apps/web/browser/trip-session.spec.ts` covers real React creation/session UX and browser-origin HTTP persistence for Item create/update/copy/delete/reorder, stale-version rejection, Location adjustment, refresh and mobile layout. Feature-specific M3 browser paths remain owned by their M3 Tasks. |

## 1. Overall Assessment

The repository contains a number of solid domain models, PostgreSQL functions, Provider/Importer/PDF spikes, and module-level tests. However, it is not yet an M2 product that can be started and used through a browser.

The current `M2 Complete for Dev Track` status should be separated into the following states:

- Some domain and application service modules are implemented.
- Some database invariants have been verified in specific local environments.
- The Web, API, Worker, and PDF Worker processes have not been assembled into real runnable applications.
- The default CI pipeline does not continuously execute all critical persistence and recovery tests.
- Production release gates such as Compose parity and the real Staging IdP remain open.

Before expanding the M3 feature scope, the P0 findings in this report should be closed, and the P1 architecture debt should be evaluated to prevent later features from amplifying it.

## 2. P0 — Immediate Blockers

### P0-01 The four applications have no runnable entry points

**Current state**

- `apps/api/src/index.mjs` only exports `processKind = "api"`.
- `apps/web/src/index.mjs` only exports `processKind = "web"`.
- `apps/worker/src/index.mjs` only exports `processKind = "worker"`.
- `apps/pdf-worker/src/index.mjs` only exports `processKind = "pdf-worker"`.
- There is no HTTP listener, route assembly, dependency injection, queue consumer, process lifecycle, or real health check.
- Runtime dependencies specified by DESIGN, such as Next.js, NestJS/Fastify, and BullMQ, are not present in the relevant application manifests.
- The current `build` only proves that modules can be compiled by TypeScript. It does not prove that the applications can start or be deployed.

**Reason**

The implementation is primarily at the domain object, application service, repository, and test-harness layers. Without composition roots, identity, configuration, authorization, HTTP, database, queue, storage, and telemetry modules cannot operate together in a real request path.

**Remediation standard**

- Provide standard root-level or per-application startup commands.
- Web, API, Worker, and PDF Worker must start from built artifacts.
- The API must expose `/health/live` and `/health/ready`, with fail-closed readiness for required dependencies.
- The API must assemble configuration, identity, routing, Problem Details, repositories, and telemetry.
- The Web application must be accessible in a browser and use the generated client.
- The Worker must consume a real queue, and the PDF Worker must consume a dedicated PDF queue.
- All processes must support graceful SIGTERM/SIGINT handling, stop accepting new work, and release connections.
- After applying migrations to an empty database, at least one real smoke path must complete login, Trip creation, Item editing, Location confirmation, and reload.
- Startup failures must not expose secrets or leave a false healthy state.

### P0-02 CI remains green when critical tests are skipped

**Current state**

- `docs/TEST_CASES.md` explicitly states that `skipped` is not equivalent to `passed`.
- The root `test:integration` command only collects `tests/config`, `tests/contracts`, `tests/infra`, and `tests/milestones`.
- The main CI test job does not start PostgreSQL/PostGIS, Redis, ClamAV, or Compose.
- Many Trip, Itinerary, Location, Attachment, Expense, Media, and Milestone tests select `test.skip` when environment variables are absent.
- `packages/database` is not a workspace package, so Turbo does not collect its tests by default.
- The current quality scripts do not fail when required cases are skipped.
- The CI workflow test explicitly asserts that the main development workflow does not run Compose.

**Reason**

The presence of test code does not mean that the tests are continuously executed. The current gate effectively means “all runnable tests passed,” not “all cases declared complete by the documentation were executed and passed.” This can produce false-green Milestone results.

**Remediation standard**

- Create a machine-readable required-case manifest for completed M0–M2 work.
- Start pinned PostgreSQL/PostGIS, Redis, MinIO, and ClamAV services in CI and apply all migrations.
- Execute every dependency-backed Task `03` case and Milestone Integration Case in CI.
- Fail CI when any required case is skipped, marked todo, not collected, or exits early.
- Report `expected / collected / executed / passed / failed / skipped` counts.
- Add `packages/database` to the workspace and quality tasks.
- Native Track may remain the daily development path, but it cannot replace Linux/Compose parity in CI or staging.
- Compose parity may be a separate release job, but it must be a required check for production release.
- Add an automated consistency check between Case IDs, test files, and result artifacts.

### P0-03 China-primary and hybrid Profiles are accepted by configuration but unsupported at runtime

**Current state**

- Configuration accepts `fixture`, `cn_primary`, `international_primary`, and `hybrid`.
- `cn_primary` configuration validation requires `AMAP_API_KEY`.
- `hybrid` configuration validation requires both AMAP and HERE credentials.
- Trip examples, tests, and design documentation frequently use `cn_primary`.
- `createConfiguredLocationSearchApi` throws `PROVIDER_PROFILE_UNSUPPORTED` for both `cn_primary` and `hybrid`.
- Configuration can therefore load successfully and a Trip can be created, but the user's first Location search fails.

**Reason**

The configuration contract, product defaults, and Provider implementations were not frozen together. Capability validation checks whether credentials exist but does not verify that the corresponding adapter can actually be constructed.

**Remediation standard**

Choose one of the following:

1. Implement an AMAP adapter and a hybrid adapter with deterministic routing and no silent failover; or
2. Remove `cn_primary` and `hybrid` from configuration, Trip input, capabilities, UI, and documentation until they are implemented.

In either case:

- Every Profile accepted by configuration must be constructible during application startup.
- Missing implementations or credentials must fail during startup, not on the first user request.
- Every Profile must cover search, reverse geocoding, error normalization, attribution, coordinate conversion, and cache isolation tests.
- Profile failures must not silently rewrite the Trip's `mapProfile` or switch Providers.

## 3. P1 — High-Priority Architecture and Delivery Issues

### P1-01 Production PostgreSQL repositories invoke `psql` subprocesses

**Current state**

Trip, Itinerary, Location, Expense, Attachment, Outbox, Media, and other repositories start a `psql` subprocess for each operation and pass the full `DATABASE_URL` as a command argument.

**Reason**

This approach may be useful as an early integration harness, but it is not suitable as the production data-access layer for an online API or Worker:

- Database credentials may be exposed through process argument inspection.
- There is no application-level connection pool.
- Every request incurs process creation overhead.
- Cancellation, timeout, backpressure, and connection-exhaustion behavior is weak.
- Stable application transaction contexts are difficult to provide.
- The implementation conflicts with the DESIGN decision to use Drizzle and parameterized spatial SQL.

**Remediation standard**

- Use a supported PostgreSQL driver with a bounded connection pool.
- Bind all inputs as parameters; do not concatenate business input into SQL.
- Do not expose `DATABASE_URL` in subprocess arguments.
- Configure connection, statement, idle-transaction, and shutdown timeouts.
- Use separate bounded pools for API and Worker processes.
- Database functions may remain, but they must be invoked through the production driver.
- Add connection exhaustion, timeout, rollback, process shutdown, and concurrency tests.
- Repository error mapping must not depend on broad substring matching of complete stderr output.

### P1-02 There is no unified Database workspace or migration runner

**Current state**

- `packages/database` has no `package.json`.
- It is not part of the Turbo workspace.
- The local stack only initializes PostGIS.
- Business migrations are primarily loaded by individual test harnesses.
- There is no unified application/deployment migration command, schema history, or upgrade-status check.

**Reason**

The database schema currently behaves more like a test asset than a deployable product component. Different environments may execute different SQL sets, and there is no proof that the upgrade path is compatible with application versions.

**Remediation standard**

- Add `packages/database` to the workspace.
- Provide unified `db:migrate`, `db:status`, and required seed commands.
- Reuse the same migration entry point in Native, Compose, CI, staging, and production environments.
- Record applied versions, checksums, and execution timestamps.
- Support idempotency checks and explicit recovery after migration failure.
- Pass a clean-database-to-latest migration test.
- Verify rolling-compatible upgrade behavior from at least the previous releasable version.
- Fail application readiness when the schema is below the minimum compatible version.

### P1-03 OpenAPI does not match the capabilities declared complete for M0–M2

**Current state**

The current OpenAPI primarily covers example, reference data, Trip, and some Itinerary paths. It does not fully cover:

- Identity and sessions;
- Trip date changes;
- Location search, candidate confirmation, and coordinate adjustment;
- Attachment upload sessions and completion;
- Expenses and exchange rates;
- Import upload and inspection;
- Job status and capabilities.

Some tests described as API E2E call services or ordinary functions directly without exercising HTTP adapters, authentication, authorization, serialization, or the generated client.

**Reason**

Application services and the public API contract have evolved separately. A passing module test therefore does not prove that clients can invoke the capability.

**Remediation standard**

- Add all current M0–M2 public capabilities to OpenAPI.
- Remove `/example`, or explicitly isolate it as a non-production contract smoke endpoint.
- Define owner/session, `Idempotency-Key`, `If-Match`, Problem Details, and pagination behavior in OpenAPI.
- Generate client support for every public route.
- For each module, add at least one test that uses a real HTTP server and generated client for successful and error responses.
- Run compatibility checks across all new paths and schemas.
- Do not allow production Web code to handcraft request DTOs that diverge from OpenAPI.

### P1-04 Most Web component/E2E tests are not component or browser tests

**Current state**

Many tests under `apps/web/e2e/*.spec.ts` run in Vitest and directly manipulate controllers, string renderers, in-memory gateways, MapLibre wrappers, or mocks. They can verify module logic, but they do not prove:

- Real React rendering;
- Routing and form submission;
- DOM accessibility semantics;
- CSS and responsive layouts;
- dnd-kit mouse, touch, and keyboard sensors;
- Browser refresh, cookies, and sessions;
- MapLibre lifecycle behavior inside the product page.

**Reason**

The test-level naming overstates the coverage level, causing Milestone reports to treat module integration tests as product E2E evidence.

**Remediation standard**

- Rename existing tests according to their actual unit/component-model/integration level.
- Use Testing Library for React components, with DOM and user-event assertions.
- After creating the real Web shell, use Playwright to cover:
  - Login and logout;
  - Trip creation from an empty account;
  - Persistence after refresh and re-login;
  - Item creation, editing, copying, and deletion;
  - Mouse, touch, and keyboard reordering;
  - Autosave, 409 conflicts, offline behavior, and leave warnings;
  - Unselected ambiguous Location candidates, map dragging, and degraded states;
  - Core editing paths on mobile viewports.
- Browser E2E tests must use the real HTTP API and must not import API source directly.

### P1-05 Core modules make extensive use of `@ts-nocheck`

**Current state**

Many source files bypass type checking with `// @ts-nocheck`, including core Trip, Itinerary, Identity, Location, Expense, Importer, and PostgreSQL repository boundaries.

Some applications also import another workspace's `src` directory through relative paths instead of using formal package exports and declared dependencies.

**Reason**

Although `pnpm run typecheck` passes, the most important data, authorization, and persistence paths are not actually protected by the strict TypeScript gate.

**Remediation standard**

- Remove `@ts-nocheck` from core domain, application, repository, and identity modules.
- Define explicit schemas for database results, error types, and external payloads.
- Expose public interfaces through package `exports`.
- Prevent `apps/*` from importing `../../packages/*/src` directly.
- Declare every real dependency in the relevant application manifest.
- Add package-boundary enforcement to CI.
- If a small number of third-party isolation files require exceptions, place them in a central allowlist with an owner, reason, and removal condition.

### P1-06 Production identity and infrastructure release gates remain open

**Current state**

- Compose parity has not been completed.
- A real Staging IdP has not been configured.
- The current Staging OIDC test is only a readiness guard.
- Real HTTPS callbacks, cookies, logout, secret rotation, and IdP outage behavior have not been verified.
- Development identity and Mock OIDC cannot serve as release evidence.
- The Identity ADR already states that horizontal scaling requires a shared, durable session/transaction adapter.

**Reason**

These are documented external and release blockers. They cannot be waived by the current Dev Track module tests.

**Remediation standard**

- Close every mandatory A02 and A05 item in `docs/runbooks/release-checklist.md`.
- Use a shared, durable session/transaction adapter.
- Verify the real Authorization Code + PKCE flow.
- Verify state, nonce, verifier, callback expiry, and replay rejection.
- Verify HTTPS cookies, logout, and key/secret rotation.
- Verify fail-closed behavior for IdP discovery/JWKS timeout, invalid signatures, and outages.
- Use Compose to verify Linux architecture, service DNS, resource limits, persistence, EICAR, and ClamAV fail-closed behavior.
- Make these results required release checks.

## 4. P2 — Engineering Governance and Evidence Reliability

### P2-01 Test evidence is not archived as required by the documentation

**Current state**

`docs/TEST_CASES.md` requires every Task to provide `test-results/<milestone>/<task>.json` or an equivalent CI artifact. The repository currently contains only `test-results/m0/A01.json`, while reports declare M0, M1, and M2 complete.

**Reason**

Task status relies primarily on manual reports and historical command descriptions. The Gate cannot automatically verify that the current main-branch commit still satisfies the relevant Cases.

**Remediation standard**

- Generate machine-readable results for every completed Task and Milestone Gate.
- Record commit, Node, pnpm, migration, fixture, executed Cases, and artifacts.
- Record skipped cases explicitly; never convert them to passed.
- Preserve initial failure evidence and subsequent retry evidence.
- Make the Gate verify that the result commit matches the closure candidate commit.
- Distinguish historical local evidence from current CI evidence.

### P2-02 README, Gate reports, and actual repository status conflict

**Current state**

- README still states that only M0 is complete and that business CRUD and product UI have not started.
- M1/M2 Gate reports state that the corresponding Dev Tracks are complete.
- The actual state is that business modules exist, but application processes and the real product UI have not been assembled.

**Reason**

The word “complete” currently covers module implementation, environment verification, product runnability, CI reliability, and production release readiness.

**Remediation standard**

- Establish a single Milestone status page.
- Track the following states independently for each Task:
  - `implemented`;
  - `runtime-integrated`;
  - `ci-verified`;
  - `release-verified`.
- Make README, Milestone reports, and the release checklist reference the same status source.
- Do not use one `Complete` label for different maturity levels.
- Update README and the status index as part of every Milestone closure.

### P2-03 Toolchain pinning is not enforced by normal quality gates

**Current state**

The repository declares exact Node and pnpm versions, but `quality`, `unit`, `build`, and similar scripts do not run the toolchain guard. With an unsupported version, pnpm may only print a warning and continue.

**Reason**

The toolchain guard is only invoked during preinstall or through a manual command. Developers and automation reusing an existing `node_modules` directory are not guaranteed to use the supported versions.

**Remediation standard**

- Run the toolchain guard before `quality`, `test:all:dev`, build, and application startup.
- Exit non-zero for unsupported Node or pnpm versions.
- Keep `.nvmrc`, `.node-version`, `packageManager`, `engines`, CI, and documentation consistent.
- If a patch range is allowed, declare the range and verify compatibility. Otherwise, preserve the exact pin.

### P2-04 Configuration and Identity use two variable vocabularies

**Current state**

Central configuration uses `APP_ORIGIN` and `SESSION_SECRET`, while the Identity ADR and Identity modules use variables such as `OTR_APP_ORIGIN` and `OTR_SESSION_SIGNING_KEY*`. Because the application is not assembled, this conflict has not yet surfaced during startup.

**Reason**

The Identity and common configuration tracks evolved independently and have not been unified in a composition root.

**Remediation standard**

- Standardize variable names and secret sources.
- If variables are renamed, define a compatibility window and detect conflicting simultaneous definitions.
- Make all four processes use one typed configuration entry point.
- Ensure the Web projection never contains database credentials, OIDC client secrets, session-signing material, or Provider keys.
- Add startup tests for missing variables, simultaneous legacy/new variables, weak production secrets, and log redaction.

### P2-05 Framework decisions and actual dependencies are not synchronized

**Current state**

DESIGN specifies Next.js, React, NestJS/Fastify, BullMQ, Drizzle, OpenTelemetry, and other components. Current manifests contain only a small subset, while some implementations use custom lightweight modules or CLI adapters.

**Reason**

Spike conclusions, target architecture, and current incremental implementation do not clearly distinguish “decided,” “adopted,” “assembled,” and “verified.”

**Remediation standard**

- Track the adoption state of every framework decision.
- If the DESIGN stack remains authoritative, add the dependencies, composition roots, and operational model.
- If lightweight alternatives are chosen, update the ADR/DESIGN before implementation.
- Do not claim that a framework forms part of the system architecture when the repository contains only unassembled modules.

## 5. P3 — Cleanup and Maintainability

### P3-01 `openapi.yaml` contains JSON

**Reason**

Although some OpenAPI tools can parse it, the extension misleads maintainers and YAML-specific tooling.

**Remediation standard**

- Rename it to `openapi.json`, or convert it to real YAML.
- Update generation scripts, baselines, documentation, and CI references.
- Preserve deterministic generated output.

### P3-02 The repository contains `.DS_Store` files

**Remediation standard**

- Remove `.DS_Store` files from the repository root and `docs/`.
- Update `.gitignore`.
- Ensure clean-install/source-digest tests do not copy operating-system metadata.

### P3-03 E2E naming and forwarding files are duplicated

**Current state**

Some Cases have both `*.e2e-spec.ts` and one- or two-line `*.e2e.spec.ts` forwarding files.

**Reason**

Multiple naming conventions accumulated during Task iterations, reducing test-report clarity and risking duplicate collection or ambiguity about the authoritative test location.

**Remediation standard**

- Freeze one test naming convention.
- Keep one authoritative test entry point per Case.
- Remove unnecessary forwarding files.
- Automatically generate or validate the Case-ID-to-file index.

### P3-04 Boundaries between build artifacts, spike evidence, and test evidence are unclear

**Remediation standard**

- Define which `dist/`, PDF, PNG, and JSON report artifacts belong in version control.
- Distinguish fixed goldens, historical spike evidence, current CI artifacts, and local caches.
- Do not infer current test results from old Turbo cache entries or historical artifacts.
- Record the version, source, checksum, and update-approval policy for large binary evidence.

## 6. Review Closure Standard

This report tracks remediation work after the M2 closure. When a follow-up agent addresses an item, it should add:

- Owner/Agent;
- Remediation commit;
- Affected files;
- Added or updated Test Cases;
- Verification environment;
- Pre-fix failure evidence;
- Post-fix passing evidence;
- Residual risks;
- Any impact on DESIGN, ADRs, OpenAPI, migrations, or the release checklist.

An item may be closed only when its remediation standard is satisfied and the evidence belongs to the current main-branch commit.
