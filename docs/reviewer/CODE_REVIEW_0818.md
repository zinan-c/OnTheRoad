# On The Road Full Code Review — 2026-08-18

> Review point: 2026-08-18, after the M4 Dev Track closure and subsequent fixes
>
> Reviewed HEAD: `effc6f41078b0972bdaa375be315515c2d6281cc`
>
> Scope: every document under `docs/`; all application, package, script,
> infrastructure, test, workflow, manifest, and root configuration sources.
> Generated build output and third-party vendored implementation internals were
> not treated as first-party product design.

## Executive assessment

The repository is buildable and has substantial domain, persistence, queue,
media, import, export, and deterministic runtime coverage. The current static
quality gate passes. No P0 finding was identified.

The repository must not, however, use the current documentation to claim that
all M0–M4 product paths are browser-accepted or that the configured online map
runtime is implemented. Four P1 findings prevent those claims:

1. several of the 22 product E2E cases execute materially different assertions
   from the manual acceptance cases they mark `Passed`;
2. M4 import confirmation and media lifecycle tests perform the decisive user
   actions through direct API requests because those controls are not assembled
   into the current product UI;
3. the Web still serves and labels a hard-coded fixture basemap, has no online
   Directions runtime, and the shared configuration still exposes HERE;
4. accepted M3/M4 evidence is bound to older commits, not the reviewed HEAD.

The correct current maturity statement is therefore:

- code quality/build: passing at the reviewed HEAD;
- M0–M3 historical required-case gates: preserved as historical evidence;
- M0–M3 22-case product-browser acceptance: not reliable as a complete 22/22
  product claim until P1-01 is corrected and rerun;
- M4 backend/runtime Dev Track: historically closed at `82c3de5`, but the full
  M4 user journey is not product-UI complete;
- online tiles, online Directions, HERE removal, and three-environment smoke:
  open post-M4 release work, consistent with ADR-003's own residual boundary.

## Verification performed

| Check | Result at reviewed HEAD | Interpretation |
|---|---|---|
| `pnpm run quality` | Passed | Required-case reference check, lint, typecheck, unit, and build pass. Dependency-backed tests that intentionally skip without their runtime are not converted into passing evidence by this command. |
| `pnpm exec playwright test --config playwright.e2e.config.ts --list` | 22 tests in 6 files | Collection count is correct; semantic parity with the documented cases is not. |
| Required-case resolver | 156 required IDs, 157 discovered IDs | `TC-E02-04` is executable but absent from the required manifest and `docs/TEST_CASES.md`; the verifier still exits successfully. |
| Full Compose/required/product E2E rerun | Not performed for this review | This report does not manufacture a new integration result. Existing closure results remain bound to their documented commits. |

## Priority summary

| Priority | Count | Meaning in this review |
|---|---:|---|
| P0 | 0 | No immediate repository-wide build or data-integrity blocker found |
| P1 | 4 | Blocks a milestone/product acceptance or production-readiness claim |
| P2 | 4 | Important correctness, reliability, or maintainability gap |
| P3 | 2 | Documentation and engineering-hygiene improvement |

## P1 findings

### P1-01 — The documented 22/22 browser acceptance result is not semantically valid

**Evidence**

- `docs/E2E_AUTOMATION_CASES.md` requires browser-originated business actions
  and marks E2E-013, E2E-018, E2E-020, and E2E-021 `Passed` with complete
  custom-mode, gallery, import, and currency-normalization behavior.
- `tests/e2e/03-itinerary-location-and-mode.spec.ts` implements E2E-013 as
  “built-in transport modes stay available without settings UI,” explicitly
  asserting that the Transport Modes button is absent. It never creates or
  deactivates a custom Mode.
- `tests/e2e/05-gallery-expenses-import-reference.spec.ts` implements E2E-018
  and E2E-020 as “temporarily hidden” checks. They assert that English-named
  regions and labels are absent; the product uses Chinese accessible names, and
  no gallery-owning Item is created. These assertions cannot prove the
  documented upload/gallery or three-format import paths.
- E2E-021 only compares option text for three selectors. It does not create and
  reload Trips/Expenses for all currencies or prove import alias normalization
  such as `RMB` to `CNY`.
- The root `test:e2e` command is not invoked by either current CI workflow. The
  required Playwright gate runs the separate `apps/web` suite.

**Reason**

Test identity is currently based on a shared E2E number, not equivalence of
preconditions, user actions, and expected outcomes. A green assertion about a
missing entry point can therefore be reported as acceptance of the feature that
the entry point should expose.

**Remediation standard**

- Make every executable E2E-001–022 case implement the same preconditions,
  browser actions, data matrix, and detailed checks as its documentation.
- For E2E-013, create, use, render, reload, and deactivate a custom transport
  Mode through Trip settings.
- For E2E-018, create the owning Item and exercise three real uploads, safe
  processing, caption, cover, reorder, lightbox, delete, and reload.
- For E2E-020, exercise `.xlsx`, `.xls`, and `.csv` through upload, inspection,
  mapping, preview, filters/counts, skip confirmation, persistence, and the
  no-production-side-effect assertion.
- For E2E-021, parameterize all 15 currencies across Trip and Expense
  persistence and verify import aliases/normalization against the public
  reference-data contract.
- Add the root product suite to a required CI job with retained traces, video on
  failure, and a machine-readable 22/22 result. Any temporarily unavailable
  product path must be `Not Ready`, not a passing inverse assertion.

### P1-02 — M4 import completion is runtime-tested but not assembled as a user journey

**Evidence**

- `ImportWorkspace` renders upload, mapping, and preview only.
- `UnresolvedLocations` exists as a component but is not imported or rendered by
  the workspace. No Web component exposes geocode start/progress, formal commit,
  media approval, cancel/resume, or final import completion.
- `apps/web/e2e/import-batch-geocode.spec.ts`,
  `import-unresolved-locations.spec.ts`, `import-confirm.spec.ts`, and
  `import-media-lifecycle.spec.ts` use `page.request` for the decisive geocode,
  decision, commit, approval, cancellation, and resume operations.
- `docs/reports/m4-gate.md` labels these cases “browser E2E,” which is technically
  true of the runner but does not mean the business actions originated in the
  browser UI.

**Reason**

Playwright's API client proves API/runtime integration, not product integration.
The current UI stops at the M3 staging boundary while the M4 gate language can
be read as a completed operator workflow.

**Remediation standard**

- Assemble geocode status, unresolved decisions, readiness, commit,
  idempotent/retry feedback, media decisions, cancel/resume, and final outcome
  into the Trip Import Workspace.
- Drive each acceptance action by visible controls; reserve `page.request` for
  read-only setup/diagnostics that the case explicitly identifies.
- Verify refresh/re-entry at every resumable state and expose Problem Details in
  actionable UI messages.
- Rerun E06–E09 browser cases on desktop and mobile and update M4 evidence to
  distinguish UI E2E from API integration.

### P1-03 — The implemented map runtime contradicts the accepted online-map contract

**Evidence**

- ADR-003 and `docs/configuration.md` define online tiles and an independent
  online Directions endpoint for `dev`, `qa`, and `prod`, with fixture only for
  explicit offline/CI use.
- `apps/web/src/features/map/map-runtime-options.ts` always points MapLibre to
  `/api/map/tiles/{z}/{x}/{y}` and hard-codes fixture attribution.
- that route always generates an in-process Philippines fixture PNG and returns
  `x-otr-map-provider: fixture`; it does not read `OTR_MAP_TILE_URL` or enforce a
  provider host allowlist/cache policy.
- No first-party runtime reads `OTR_DIRECTIONS_BASE_URL`,
  `OTR_DIRECTIONS_ATTRIBUTION`, or `OTR_ONLINE_MAP_REQUIRED`.
- `packages/config/src/env.ts` still parses HERE endpoints and credentials and
  exposes `hereApiKey`, while ADR-003 says HERE is removed from the current
  architecture.

**Reason**

MAP-01 Nominatim work was merged without freezing the related tile, Directions,
fail-closed, and provider-removal configuration boundary. Current Trip maps can
look like real geographic maps while still being deterministic fixture assets.

**Remediation standard**

- Implement MAP-02/03/04: environment-validated tile and non-HERE Directions
  adapters, provider attribution, allowlists, timeout/cache/rate behavior,
  degraded state, metrics, and real `dev`/`qa`/`prod` smoke evidence.
- Make fixture selection explicit and observable; never silently substitute it
  for an online-required environment.
- Remove HERE from active configuration types, validation, runtime factories,
  secrets, current provider exports, and current tests. Historical ADR/spike
  evidence may remain clearly marked historical.
- Treat production release as No-Go until online Directions and all three
  environment smokes pass at an exact commit.

### P1-04 — Current milestone evidence is not bound to the reviewed HEAD

**Evidence**

- The M4 gate is bound to `82c3de537e67501d761e2c107a011cc32bf009d9`.
- The product-browser document records 22/22 on 2026-08-11 and references older
  implementation evidence.
- The reviewed HEAD is `effc6f41078b0972bdaa375be315515c2d6281cc`, after
  multiple CI, map, itinerary, import-staging, and runtime changes.
- This review's passing `quality` command does not start the full dependency
  stack and does not execute the root 22-case product suite.

**Reason**

Commit-bound evidence is immutable by design. Later behavior and CI changes do
not inherit an earlier commit's integration acceptance merely because static
quality remains green.

**Remediation standard**

- After P1-01/P1-02 are resolved, run the complete required 156-case gate, the
  corrected 22-case product suite, runtime smoke, PDF Worker smoke, and release
  evidence verifier on one clean exact SHA.
- Archive machine-readable counts and diagnostics and bind the new report to the
  full 40-character SHA.
- Keep historical M3/M4 reports immutable; update only the canonical current
  status index with the new evidence and explicitly retain release-only gaps.

## P2 findings

### P2-01 — Required-case consistency validation is one-way

**Evidence**

`verify-required-cases.mjs` rejects required IDs missing from documentation or
tests, but does not reject executable IDs absent from the manifest or
documentation. At this review point it reports `expected=156 resolved=157`;
the extra `TC-E02-04` lives in `apps/web/e2e/import-upload-chain.spec.ts`.

**Remediation standard**

- Enforce a bijection among active documented IDs, manifest IDs, executable IDs,
  and result IDs, with an explicit allowlist for historical/non-required cases.
- Add `TC-E02-04` to the governed contract or rename/remove its TC identity.
- Fail on duplicate ownership, unexpected active IDs, and count disagreement.

### P2-02 — The Web has multiple handwritten API clients outside the generated contract

**Evidence**

Trip creation/settings and a few screens use `OnTheRoadClient`, but itinerary,
gallery, location, expense, import, preview, unresolved-location, map, and
workspace code implement separate `fetch` wrappers and local response types.
They differ in accepted media types, Problem Details parsing, headers, and error
behavior.

**Remediation standard**

- Extend the generated client for all public operations and use one authenticated
  browser transport with consistent Problem Details and request-ID handling.
- Keep signed object-storage PUT as an explicit non-API transport.
- Add compile-time and route-parity checks so a contract change cannot leave a
  handwritten screen DTO silently stale.

### P2-03 — Import polling can time out without a terminal result

**Evidence**

`ImportWorkspace` polls inspection 90 times and mapping state 180 times. When
the limit is exhausted, the loops fall through without setting an explicit
timeout/failure state. Polls are not cancelled when the component unmounts or a
new upload supersedes the old one.

**Remediation standard**

- Model polling as a cancellable state machine with an absolute deadline,
  terminal-state validation, retry/backoff, and explicit timeout UI.
- Abort on unmount, Trip change, logout, or superseding upload.
- Test slow, never-terminal, failed, cancelled, superseded, and reload/resume
  paths without leaking requests or showing stale success.

### P2-04 — Product E2E device coverage does not match a general mobile claim

**Evidence**

The root 22-case Playwright config has one desktop Chromium project. E2E-012
opens one Pixel 7 context for reorder, but the other product cases are not run as
a mobile matrix. The separate required-case config has desktop and mobile
projects, but it runs a different test suite.

**Remediation standard**

- Define which product cases are required on desktop, mobile, or both in the
  manifest.
- Run the declared project matrix in CI and report project-specific results.
- Cover mobile dialogs, map gestures, upload controls, import tables, gallery,
  settings, and recovery states, not only reorder.

## P3 findings

### P3-01 — Current status documentation needs machine-checked claim vocabulary

**Evidence**

The documentation uses “browser E2E,” “product-browser accepted,” “Dev Track
complete,” and “release gate open” correctly in some places but interchangeably
in others. This allowed API-client Playwright tests and inverse hidden-entry
tests to support broader product claims.

**Remediation standard**

- Standardize evidence types: unit, component, API integration, runtime
  integration, UI E2E, staging smoke, and production release.
- Require each status claim to identify environment, exact SHA, originating
  interface, device project, result artifact, and residual boundary.
- Add a docs lint/check that prevents a `Passed` manual case from pointing to an
  executable case with a different title or missing required action tags.

### P3-02 — Large composition modules concentrate unrelated change risk

**Evidence**

`apps/api/src/app.ts` is about 1,400 lines and
`apps/web/src/features/itinerary/itinerary-panel.tsx` is about 960 lines. Each
combines routing/composition or data access/state/rendering across multiple
business areas, increasing review surface and merge/regression risk.

**Remediation standard**

- Split API controllers/composition by bounded module while retaining one
  explicit composition root.
- Split the itinerary panel into typed gateway, editor state, timeline, expense,
  location, and transport components with contract-level tests.
- Keep cross-module transaction/invariant ownership in application/domain
  services; do not move it into UI helpers during the split.

## Acceptance baseline for closing this review

This review is closed only when every P1 and P2 item has:

1. a code or documentation change linked to the finding;
2. an executable regression test that proves the remediation standard rather
   than only sharing its identifier;
3. an exact-SHA, machine-readable result with zero failed, skipped, todo, or
   uncollected required cases;
4. updated security, observability, operations, and user-documentation evidence
   where the change affects those boundaries;
5. an independent reviewer sign-off that distinguishes Dev Track completion
   from production release approval.

P3 items may be closed independently, but they must not be used to defer or
relabel the P1/P2 acceptance gaps.
