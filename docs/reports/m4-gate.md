# M4 development gate

- Status: **M4 Dev Track complete; release gates remain separate**
- Gate run: 2026-08-14 Asia/Shanghai (`2026-08-13T16:08:38Z`–`2026-08-13T16:12:49Z`)
- Closure SHA: `82c3de537e67501d761e2c107a011cc32bf009d9`
- Baseline: macOS arm64, Node 26.0.0, pnpm 9.15.4
- Scope: E06–E09, F01–F03, F05, and `TC-M4-INT-01` through
  `TC-M4-INT-03`
- Required-case scope: 156 active Cases (129 historical M0–M3 Cases, 24 M4
  Task Cases, and 3 M4 integration Cases)

## Closure result

The official `pnpm run ci:local` completed successfully on the exact closure
SHA with the real Compose dependency stack and application runtimes:

| Evidence | Result |
|---|---|
| Required Cases | **156 expected / 156 collected / 156 executed / 156 passed** |
| Failed / skipped / todo / not collected | **0 / 0 / 0 / 0** |
| Vitest required groups | All 16 groups exit 0; no failed files |
| Node test group | Exit 0 |
| Playwright required group | Exit 0; desktop and mobile projects included |
| Commit-bound evidence verification | Passed for the exact 40-character closure SHA |
| Database schema check | Migration version 25/25; clean and compatible |
| PDF Worker queue round-trip | 1 test passed |
| Clean-checkout smoke | 3 tests passed |

The real runtime path was:

```text
PostgreSQL/PostGIS + Redis + MinIO + ClamAV
        ↓
       API → Redis/BullMQ → Worker
        ↓                    ↓
      Web E2E              PDF Worker
```

All four Compose dependencies reached healthy state. API readiness returned
success with database, schema, Redis, storage, ClamAV, and map-provider checks;
Worker queue processing and the PDF Worker heartbeat were observed before the
required-case run. The Compose stack was stopped by the CI cleanup trap after
the successful run; named volumes were preserved.

The machine-readable result is
`test-results/local-m0-m4-required.json`. Runtime diagnostics are in
`test-results/m4-readiness.json`, `test-results/m4-api.log`,
`test-results/m4-worker.log`, `test-results/m4-pdf-worker.log`, and
`test-results/m4-pdf-worker-smoke.log`. These local files are ignored build
artifacts; this report records their accepted result and exact binding.

## Task and integration evidence

| Scope | Evidence | Final result |
|---|---|---|
| E06 | `64c411b` — batch scheduling/failure recovery and browser E2E | Included in the 156/156 closure run |
| E07 | `18aeb0d` — staged-location decisions and unresolved-location browser E2E | Included in the 156/156 closure run |
| E08 | `e33e71b` plus `30e574d` — replay/race coverage and confirm-import browser E2E | Included in the 156/156 closure run; real same-key replay passed |
| E09 | `cb5e3ad` — media lifecycle, SSRF/lease/retry coverage and browser E2E | Included in the 156/156 closure run |
| F01 | `566d79b` — media preflight integration and ExportJob E2E | Included in the 156/156 closure run |
| F02 | Existing static-map manifest/degraded/visual cases | Included in the 156/156 closure run |
| F03 | `efe7882` — print chapter/edge-content coverage and Preview/Worker contract | Included in the 156/156 closure run |
| F05 | Existing stage/CAS, security/cancel, and resource-ready render cases | Included in the 156/156 closure run |
| M4 integration | `29fd881` — three unified milestone integration files | Included in the 156/156 closure run |

The three M4 integration files are:

- `tests/milestones/m4/import-commit.e2e.spec.ts`
- `tests/milestones/m4/import-media-race.e2e.spec.ts`
- `tests/milestones/m4/export-rehearsal.e2e.spec.ts`

They cover geocode → confirmation → commit → route generation and replay,
import/media concurrency with SSRF and lease recovery, and frozen ExportJob
snapshot rendering with cancellation protection.

## QG-01/QG-02/QG-05 closure evidence

| Quality gate | Accepted closure evidence |
|---|---|
| QG-01 import concurrency/idempotency | The required M4 concurrency, claim, ledger, override, and replay cases all passed in the 156/156 run. The real E08 browser path committed two rows, then repeated the same `e08-confirm-replay` key successfully without creating duplicate facts. The API → Redis/BullMQ → Worker path and PostgreSQL constraints were exercised by the run. |
| QG-02 cancellation/recovery | The required scheduling, cancel/resume, media race, lease fencing, queue-loss reconciliation, parent aggregation, and recovery cases all passed. The same Compose run kept API, Worker, Redis, and database live through the full required suite; worker queue completion logs and schema checks are archived in the local diagnostics. |
| QG-05 media durability/security/export completeness | The required media lifecycle, SSRF/DNS/redirect, approval, lease/retry, parent convergence, media preflight, frozen snapshot, and export cases all passed. The real object-storage/scanner-backed stack reached readiness, and the real PDF Worker queue round-trip passed with no silent completion or download claim. |

These QGs are closed for the M4 Dev Track on the closure SHA. They do not
constitute production release approval or replace the separate A02 release
parity, A05 identity, real-provider, capacity, and release-sign-off gates.

## Verification commands

The closure was produced by the repository's official local CI sequence:

1. `OTR_COMPOSE_PULL_POLICY=never pnpm run ci:local`
2. `pnpm run test:cases:required`
3. `pnpm run test:cases:evidence`
4. `pnpm run test:pdf-worker-smoke`
5. `pnpm run ci:smoke`

The `ci:local` sequence also ran the aggregate quality gate, database migrate /
seed / status checks, runtime readiness checks, and final `git diff --exit-code`.

## Residual release boundary

M4 is **Done for the Dev Track**. M5–M6 remain planned. Production release is
not approved by this report: A02 Linux/Compose parity, A05 staging IdP,
real-provider checks, capacity evidence, and the remaining release checklist
items remain separate release gates.

The M4 result does not close the post-M4 online map workstream. The accepted
M4 run used deterministic provider/fixture paths; the current architecture now
targets public Nominatim for online geocoding, online tiles, and an independent
non-HERE Directions endpoint in `dev`/`qa`/`prod`. See
[`ADR-003`](../adr/003-online-nominatim-map-runtime.md) and
[`nominatim-online-plan.md`](./nominatim-online-plan.md).
