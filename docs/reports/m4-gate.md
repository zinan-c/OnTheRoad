# M4 development gate

- Status: **M4 implementation complete; Dev Track Gate open**
- Gate preparation date: 2026-08-13
- Implementation SHA: `29fd881741060a60d6c11066134c9a4cc24e6553`
- Baseline: macOS arm64, Node 26.0.0, pnpm 9.15.4
- Scope: E06–E09, F01–F03, F05, and `TC-M4-INT-01` through
  `TC-M4-INT-03`
- Required-case scope: 156 active Cases (129 historical M0–M3 Cases, 24 M4
  Task Cases, and 3 M4 integration Cases)

This report records the M4 implementation handoff and the evidence available
on the implementation SHA. It does not claim M4 Dev Track closure: the
commit-bound M0–M4 required-case run against the real dependency stack has not
yet completed.

## Task and integration evidence

| Scope | Evidence | Result |
|---|---|---|
| E06 | `64c411b` — batch scheduling/failure recovery and browser E2E | Implemented; affected tests previously passed |
| E07 | `18aeb0d` — staged-location decisions and unresolved-location browser E2E | Implemented; affected tests previously passed |
| E08 | `e33e71b` — exact replay/race coverage and confirm-import browser E2E | Implemented; affected tests previously passed |
| E09 | `cb5e3ad` — media lifecycle, SSRF/lease/retry coverage and browser E2E | Implemented; affected tests previously passed |
| F01 | `566d79b` — media preflight integration and ExportJob E2E | Implemented; affected tests previously passed |
| F02 | Existing static-map manifest/degraded/visual cases | Present in the M4 required scope |
| F03 | `efe7882` — print chapter/edge-content coverage and Preview/Worker contract | Implemented; affected tests previously passed |
| F05 | Existing stage/CAS, security/cancel, and resource-ready render cases | Present in the M4 required scope |
| M4 integration | `29fd881` — three unified milestone integration files | 3 files / 4 tests passed locally |

The three M4 integration files are:

- `tests/milestones/m4/import-commit.e2e.spec.ts`
- `tests/milestones/m4/import-media-race.e2e.spec.ts`
- `tests/milestones/m4/export-rehearsal.e2e.spec.ts`

They cover geocode → confirmation → commit → route generation and replay,
import/media concurrency with SSRF and lease recovery, and frozen ExportJob
snapshot rendering with cancellation protection.

## QG-01/QG-02/QG-05 evidence boundary

| Quality gate | Current deterministic evidence | Real-stack closure evidence |
|---|---|---|
| QG-01 import concurrency/idempotency | `TC-E08-01`, `TC-E08-02`, `TC-E08-03`, and `TC-M4-INT-01` cover exact replay, owner-aware insert/update races, cancel/resume, override scope, ledger/claim, and route-generation assertions. | PostgreSQL barrier/constraint execution, schema CHECKs, and the full API → Redis/BullMQ → Worker path must still be run and archived. |
| QG-02 cancellation/recovery | `TC-E06-02`, `TC-E08-02`, `TC-E09-03`, and `TC-M4-INT-02` cover retry/cancel checkpoints, resume, lease fencing, queue-loss recovery, parent aggregation, and media rebind behavior using deterministic repositories/faults. | Redis loss reconciliation, upload/worker cancellation races, orphan cleanup, and runtime process recovery on the real stack remain open. |
| QG-05 media durability/security/export completeness | `TC-E09-01`, `TC-E09-02`, `TC-F01-02`, `TC-F01-03`, and `TC-M4-INT-02` cover approval fencing, SSRF/DNS/redirect checks, lease/retry generation, parent convergence, media preflight, and frozen export inputs. | Durable PostgreSQL media-task persistence, real object-storage/scanner flow, DB reconciliation, and PDF no-silent-omission evidence remain open. |

Accordingly, all three QGs are **fixture/contract evidence present; real-stack
closure pending**. They are not counted as closed M4 Gate criteria in this
report.

## Verification performed

The following checks were run on the implementation SHA while preparing this
report:

- `pnpm exec vitest run tests/milestones/m4 --no-file-parallelism --maxWorkers=1`
  — **3 files passed, 4 tests passed**.
- `pnpm run test:cases:verify` — **156 required Cases resolve to executable
  tests; no missing documentation, missing executable, or deprecated required
  Case**.
- Toolchain — Node `v26.0.0`, pnpm `9.15.4`.
- Worktree was clean before this documentation/manifest change set.

The M4 tests and task evidence currently use deterministic fixture/fake
repositories where documented. The required-case runner is now wired to
`test-manifests/m0-m4.required.json`; the historical M0–M3 manifest remains
unchanged for the M3 closure record.

## Gate status and open evidence

M4 cannot be marked **Done for the Dev Track** until all of the following are
completed on a clean exact-SHA checkout:

1. Run `pnpm run ci:local` or the equivalent CI workflow with the real
   PostgreSQL/PostGIS, Redis, MinIO, ClamAV, API, Worker, Web, PDF Worker, and
   Playwright stack.
2. Produce a commit-bound `test-results/local-m0-m4-required.json` (or CI
   artifact) with `156 expected / 156 collected / 156 executed / 156 passed`,
   and zero failed, skipped, todo, or uncollected Cases.
3. Verify the managed database schema fingerprint is unchanged across the
   required-case run and archive runtime readiness, migration, fixture, and
   failure diagnostics.
4. Close the M4 architecture/security difference review required by the
   execution plan, including QG-01, QG-02, and QG-05 evidence:
   - QG-01: concurrent import insert/update, replay, claim, and override
     invariants;
   - QG-02: cancellation, upload race, resume, Redis-loss reconciliation, and
     orphan cleanup;
   - QG-05: durable media tasks, approval/SSRF fencing, lease expiry,
     reconciliation, and export preflight completeness.
5. Run the documented M4 demonstration path: missing-coordinate import,
   ambiguous/text-only confirmation, duplicate-safe commit, approved media,
   and an ExportJob that keeps its creation snapshot after Trip edits.

The current workstation has the required command-line tools but no running
Docker daemon. Therefore the real-stack Compose/API/Worker/PDF Worker Gate
and QG closure are intentionally **pending**, not marked passed.

## Residual release boundary

M4 Dev Track closure will not mean production release approval. A02 Compose/
Linux parity, A05 Staging IdP, real-provider checks, and the remaining release
checklist items remain separate release gates.
