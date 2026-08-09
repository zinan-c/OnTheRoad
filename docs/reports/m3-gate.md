# M3 development gate

- Status: **M3 Done for the Dev Track**
- Gate execution date: 2026-08-03
- Final closure review date: 2026-08-08
- Product-browser re-acceptance date: 2026-08-09 — **21/21 passed**
- Exact closure SHA: `10d7c1d03c7a1df579ac37f79b71bbfef5919424`
- Baseline: macOS arm64, Node 26.0.0, pnpm 9.15.4
- Runtime: native PostgreSQL 17/PostGIS, authenticated Redis, native MinIO,
  ClamAV, ImageMagick, real Nest/Fastify API, BullMQ Worker, Next.js, and
  Playwright Chromium
- Browser re-acceptance implementation SHA: `c0e2e3a4f2ca65e92b33dee1f1a44e3b41ce6b28`

## Task commits

| Task | Foundation | Product integration |
|---|---|---|
| C07 | `c287bf8` | `c13288e` |
| C08 | `f01ce3f` | `38f64d2` |
| C09 | `f7f58e8` | `b328d2a` |
| D03 | `4abea81` | `cfa891a` |
| D05 | `4e267bb` | `1d28334` |
| E03 | `b51b666` | `0973b36` |
| E04 | `70d3c5f` | `a71f495` |
| E05 | `f313418` | `98e67aa` |

The integration and evidence chain is recorded by `c13288e`, `82a24be`,
`abecb57`, and `506e8fd`. Public-contract closure, Product acceptance, and the
final R&D/evidence review are recorded by `565365a`, `232387b`, and `10d7c1d`.

## Milestone gate evidence

`TC-M3-INT-01` passed against the production PostgreSQL repositories and route
processor. It verified:

- current route segments after an A→B→C reorder, including synchronous
  obsolescence before the replacement route is generated;
- resolved, pending, within-day, and cross-day route boundaries;
- persisted gallery caption, cover, reorder, delete, and reload behavior;
- fixed-decimal expense totals across day, destination, category, transport
  mode, and original currency.

`TC-M3-INT-02` staged 5,000 rows through the production import staging
processor. It verified:

- 4,999 valid rows and one field-level error;
- deterministic paging and source row keys;
- idempotent replay of the same staging job;
- no formal Item or Location side effects.

The required browser cases ran through the real Next.js UI and Nest/Fastify API
on desktop and mobile Chromium. They covered route visualization and detail,
map/timeline focus, gallery behavior, cost summary, editable mapping, staging
preview, and the upload-to-inspection entry chain.

## Gate hardening performed during closure

The first diagnostic pass exposed historical test migrations that could
silently overwrite a newer managed schema. Required-case database harnesses now
detect `otr_schema_migration` and never replay historical migrations against a
migration-managed database.

Migration `0021_reorder_route_generation.sql` makes the M3 itinerary-change
trigger the single owner of route generation invalidation. Reorder no longer
increments the generation independently before the trigger runs.

The required-case runner now fingerprints public columns, constraints, indexes,
routines, triggers, policies, views, and enums. Local and GitHub Gates set
`OTR_SCHEMA_IMMUTABILITY_DATABASE_URL`; the runner stops immediately if any
Vitest, Node, or Playwright stage changes the managed schema.

API and Worker startup in the local and GitHub Gate explicitly uses the `dev`
profile. This prevents a raw process start from bypassing the validated runtime
configuration.

## Verification

- `pnpm run quality`: passed required-case consistency, lint, typecheck, unit,
  and build across all workspaces.
- Fresh environment bootstrap: PostGIS initialized; migrations `1–21` applied;
  seed counts were 15 currencies, 9 cost categories, and 22 transport modes;
  schema status was compatible with no pending or dirty migration.
- Migration runner: 2 files and 3 tests passed, including interruption recovery
  and rollback behavior.
- Preflight required Vitest groups: 118 files and 285 tests passed serially
  without starting API or Worker.
- Preflight required Node group: 14 tests passed.
- Final runtime start: API and Worker were each started once. Readiness required
  both `/health/ready` and a Worker heartbeat; neither process was restarted.
- Final required-case Gate:
  `129 expected / 129 collected / 129 executed / 129 passed / 0 failed /
  0 skipped / 0 not collected`.
- Managed schema fingerprint before and after:
  `e2cba4c9fedb534e0aef180bc61737ca|1611`.
- Final local machine-readable evidence:
  `test-results/local-m0-m3-required.json`, verified against full SHA
  `10d7c1d03c7a1df579ac37f79b71bbfef5919424` with `worktreeClean=true` and
  Node `v26.0.0`. This is an ignored diagnostic path; the GitHub workflow
  uploads the durable commit-bound artifact after push.

## E04 contract freeze and M4 handoff

The E04 staging contract is frozen at the M3 boundary:

- canonical mapping and mapping hash;
- immutable source attachment identity;
- stable source row key and row number;
- raw and normalized row payloads;
- explicit `new`, `update`, `duplicate`, `error`, `unresolved`, and `skipped`
  result states;
- staging isolation from formal Item and Location rows.

E06 and E07 must rebase on this contract. Any change to these fields, states,
or uniqueness rules requires the documented `LOCK-IMPORT-SCHEMA` and a new
migration; M4 must not mutate the M3 history.

## Product acceptance

The Product Owner accepted the integration result, M3 acceptance result, and
written demonstration record on 2026-08-08. The signed record is archived in
`docs/reports/m3-product-acceptance.md` against technical baseline `565365a`.

## 2026-08-09 product-browser re-acceptance addendum

The original 129/129 exact-SHA closure Gate above remains the historical M3
technical evidence. After the missing product entry points and runtime browser
paths were completed, the repository added a separate Playwright acceptance
suite for E2E-001 through E2E-021 and reran every documented manual path.

- Result: **21 passed / 0 failed / 0 skipped** in 1.4 minutes.
- Implementation commit: `c0e2e3a4f2ca65e92b33dee1f1a44e3b41ce6b28`.
- Toolchain: Node `v26.0.0`, pnpm `9.15.4`, Playwright Chromium.
- Runtime: real Next.js Web, Nest/Fastify API, BullMQ Worker, PostgreSQL with
  PostGIS, Redis, MinIO-compatible storage, ClamAV/ImageMagick, and fixture
  Geocoding/Directions/Tile Providers through production runtime contracts.
- Isolation: a fresh dedicated database was migrated and seeded for the run,
  then destroyed by the harness.
- Browser boundary: all accepted business writes originated from visible UI
  operations. No test used `page.evaluate()` or an independent HTTP client to
  substitute for Item, Location, Trip, Gallery, Expense, or Import CRUD.
- Route evidence: E2E-016/017 exercised DirectionsProvider → Worker → persisted
  Route API → MapLibre, including tile requests, route details, selection,
  cross-Day and Transport-internal segments, invalidation, and blockers.

The executable cases and per-case status are archived in
`docs/E2E_AUTOMATION_CASES.md`; the Product Owner acceptance addendum is in
`docs/reports/m3-product-acceptance.md`.

## Final R&D closure review

The final R&D review closed commit binding, M3 security/privacy review,
production API/Worker observability, documentation, and formal DRI/automated-QA
evidence sign-off. The complete ten-rule decision is archived in
`docs/reports/m3-rnd-final-review.md`.

## Release handoff

This closes M3 only for the Dev Track. It is not production release approval:

- real HERE Routing remains a controlled staging check requiring explicit
  network approval;
- the A05 real Staging IdP checklist remains mandatory before release;
- A02 Compose/Linux parity remains a release checklist item.
