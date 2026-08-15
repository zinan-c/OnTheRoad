# M3 R&D final closure review

> Historical provider note: the real HERE Routing credential/network statement
> below belongs to the M3 release boundary. It is retained as evidence and is
> superseded as a current choice by [`ADR-003`](../adr/003-online-nominatim-map-runtime.md).

- Review date: **2026-08-08 (Asia/Shanghai)**
- Review role: **M3 R&D / Milestone DRI and automated QA evidence reviewer**
- Product acceptance: `docs/reports/m3-product-acceptance.md`
- Decision: **M3 Done for the Dev Track**
- Exact closure SHA: `10d7c1d03c7a1df579ac37f79b71bbfef5919424`
- Browser evidence addenda: **2026-08-09 — 21/21 passed on `c0e2e3a`; 2026-08-11 — 22/22 passed**

## Review scope

This review rechecked every M3 Task and Case, the two M3 integration Cases,
runtime/API/Worker/Web composition, OpenAPI and generated client, migrations,
security and privacy controls, telemetry, configuration, runbooks, Gate
evidence, and the Product Owner's acceptance and demonstration record.

## Commit-bound evidence control

Required-case reports now resolve a full Git SHA locally when `GITHUB_SHA` or
`OTR_COMMIT_SHA` is not provided, and record whether tracked files were clean
during execution. `scripts/verify-required-case-report.mjs` rejects evidence
unless all of the following hold:

- the report is `passed` and bound to the exact expected 40-character SHA;
- the worktree was clean during the Gate;
- Node matches `.nvmrc`;
- expected, collected, executed, and passed counts are equal and positive;
- failed, skipped, and uncollected counts are zero.

Both local push CI and GitHub `CI-Test Cases` run this verification immediately
after the required-case Gate. GitHub uploads the report and browser artifacts;
the local equivalent is `test-results/local-m0-m3-required.json`. These paths
are test artifacts rather than version-controlled historical claims.

The final exact-SHA Gate was executed from clean closure commit
`10d7c1d03c7a1df579ac37f79b71bbfef5919424`. Its report was verified with
`pnpm run test:cases:evidence`: 129 expected, collected, executed, and passed;
zero failed, skipped, or uncollected. The evidence therefore cannot silently
refer to an older or dirty source tree.

## Security and privacy review

| M3 surface | Threats reviewed | Control and evidence | Result |
|---|---|---|---|
| Routing | Cross-owner read/write, stale generation overwrite, route across a missing/unconfirmed location, provider failure | Owner-scoped repositories; generation/sourceVersion CAS and final adjacency lock; missing-location blocker; C07 race and M3 integration Cases | Pass |
| Gallery/media | Malicious or malformed upload, immutable-object substitution, non-ready exposure, cross-owner mutation, ordering race | Bounded upload session; magic/ClamAV/ImageMagick pipeline; immutable version/checksum; owner filters; optimistic versions; D02/D03 security and integration Cases | Pass |
| Expenses | Cross-owner facts, binary floating-point drift, missing-rate false success | Owner-scoped PostgreSQL queries, fixed decimal strings, explicit unconverted groups, D04/D05 integration and reconciliation Cases | Pass |
| Excel staging | Workbook bombs/malformed input, formula content, staging-to-formal leakage, mapping collision, replay ambiguity | Isolated bounded inspection; security fixtures; canonical mapping hash/source-row key; staging constraints; `TC-M3-INT-02` formal-count assertion | Pass |
| HTTP/telemetry | Session or signed URL disclosure, concrete entity IDs as metric labels, undocumented public routes | Session-cookie owner derivation; recursive redaction; route-template metrics; bidirectional OpenAPI/runtime parity; telemetry safety tests | Pass |

No open Critical or High security/privacy finding was identified in the M3
scope. This is a Dev Track threat review, not production release authorization.
At the M3 checkpoint, real HERE Routing credentials/network behavior, Staging
IdP, and Compose/Linux parity remained release checklist requirements. The HERE
reference is historical; current online Directions selection is governed by
ADR-003.

## Observability review

- API requests produce correlation headers, bounded request count/duration
  metrics, completion spans, and sanitized error-code logs.
- Import inspection, import staging, and media processing produce queue
  count/duration metrics, completion spans, and sanitized failure codes.
- Route, Attachment, Expense, ImportJob, and ImportRow state remains
  PostgreSQL-authoritative; Redis is delivery/recovery infrastructure only.
- Telemetry sink failure cannot change the business outcome.
- PII, Secrets, signed URLs, concrete paths, and entity IDs are excluded from
  M3 telemetry and are covered by executable tests.

## Documentation review

- OpenAPI and generated client now cover every M0–M3 public Controller route,
  with bidirectional parity enforced.
- The M3 Gate report uses the pinned Node 26.0.0 baseline and links the Product
  Owner acceptance.
- The E04 contract freeze, M4 handoff, release-only residual gates, executable
  Case index, observability behavior, and written demonstration record are
  archived.
- No M3 feature flag or M3-only rollback toggle exists. Application rollback
  follows the compatible-migration rules in the development plan; queued work
  remains database-authoritative and recoverable.

## Unified closure decision

| Rule | Result | Closure evidence |
|---|---|---|
| 1. Scope | Pass | C07–C09, D03, D05, E03–E05 implementation and all `01/02/03` Cases |
| 2. Code | Pass | Main-branch commits, aggregate quality Gate, zero skipped/uncollected required Cases |
| 3. Data | Pass | Real PostgreSQL/PostGIS migrations, constraints, owner/state/idempotency integration |
| 4. Contract | Pass | Complete M0–M3 OpenAPI/generated client and bidirectional route parity |
| 5. Exceptions | Pass | Every Task `02` Case plus route/media/import fault and race coverage |
| 6. UX | Pass | Desktop/mobile browser Cases and component loading/error/retry states |
| 7. Security/privacy | Pass | Threat matrix above; no open Critical/High M3 finding |
| 8. Observability | Pass | API/Worker runtime telemetry and DB-authoritative state evidence above |
| 9. Documentation | Pass | Gate, Product acceptance/demo, observability, E04 handoff, release boundary |
| 10. Sign-off | Pass | Product signature plus R&D/DRI and automated QA evidence signatures below |

## R&D and QA-evidence sign-off

As M3 R&D / Milestone DRI, I certify that the technical scope, contract,
failure-path coverage, security review, observability, documentation, and
commit-bound Gate controls satisfy the unified closure rules.

As the automated QA evidence reviewer, I certify that the required-case Gate is
configured to reject missing, failed, skipped, todo, uncollected, dirty-tree, or
wrong-commit evidence. This signature covers the archived automated QA result;
it does not claim an independent external human QA identity.

- **M3 R&D / Milestone DRI:** `RND-M3-DONE-2026-08-08`
- **Automated QA evidence review:** `QA-EVIDENCE-M3-PASS-2026-08-08`
- **Product Owner:** `PROD-M3-ACCEPTED-2026-08-08-565365a`

With all ten rules satisfied and the product acceptance/demo record archived,
M3 is **Done for the Dev Track**. Production release remains a separate Gate.

## 2026-08-09 browser evidence addendum

The follow-up product-browser suite executed all 21 cases in
`docs/E2E_AUTOMATION_CASES.md` against implementation commit `c0e2e3a` with
zero failures and zero skips. This closes the browser-level entry-point and
runtime-path gaps that were not represented by the original 129-case technical
Gate, including E2E-016/017's complete DirectionsProvider-to-MapLibre path.

The addendum changes no production-release conclusion: real external Provider,
Staging IdP, and Compose/Linux parity remain separate release gates.

## 2026-08-11 browser and A02 status addendum

The E2E-022 map regression re-acceptance completed the full
`E2E-001`–`E2E-022` matrix with **22 passed, 0 failed, 0 skipped**. It verified
Global/Day map scope, stable MapLibre bounds, coordinate-editor raster
configuration, and the existing M3 route/gallery/expense/import paths. No M3
product Case or browser acceptance gap remains in the current Dev Track record.

The same date's local Compose verification closed the development-stage A02
gate: PostgreSQL/PostGIS, Redis, MinIO, and ClamAV readiness, persistence,
idempotent initialization, EICAR detection, and ClamAV fail-closed behavior all
passed. These local results do not close the separate CI/staging Compose/Linux
release parity gate.
