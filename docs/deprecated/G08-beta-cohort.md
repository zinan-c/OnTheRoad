# G08 Beta cohort and gray-sample operations — Deprecated

> Status: **Deprecated**
>
> Decision date: **2026-07-29**
>
> Former scope: **M1 start, M6 convergence**

## Decision

G08 was removed from the mandatory MVP plan before implementation. It is no longer an M1 task, a cross-milestone activity, or an M6/GA gate. The G08 task ID and its test IDs remain reserved for traceability and must not be reused.

No cohort recruitment, consent ledger, test-account pool, sample-count dashboard, or G08-specific automation is to be created under the current plan.

## Why it was removed

- The current delivery does not require a dedicated test-user cohort.
- Engineering release readiness can be evaluated by G02–G07, quality gates, fault injection, capacity/security/recovery evidence, observability, and rollback readiness.
- Creating synthetic accounts solely to satisfy a real-user count would produce misleading evidence.
- User validation may still be valuable, but it is a product-research activity that should be separately scoped when there is a concrete need, owner, channel, and privacy basis.

## Plan impact

| Area | Before | After |
|---|---|---|
| M1 | G08 started in Wave 3; M1 total 35 ideal person-days | G08 removed; M1 total 33 ideal person-days |
| M6 | G08 converged into the gray gate | M6 contains G02–G07 only; estimate remains 23 ideal person-days |
| Test cases | `TC-G08-01`–`03` and `TC-M6-INT-03` were mandatory | Cases are Deprecated, IDs reserved, and no test files are created |
| GA gate | Fixed real Beta/Trip sample minimums | Technical evidence and staged release approval; no fixed user-sample minimum |
| Risk R44 | Beta sample shortage/dedup was an active release risk | Deprecated historical risk; excluded from release judgment |

The effective P0 task-table total changes from 225 to 223 ideal person-days. G08 remains visible as a zero-day Deprecated row so the scope change is auditable.

## M6 replacement

Release readiness is established through:

- G02–G07 and all their effective Task `03` cases;
- `TC-M6-INT-01` release-matrix evidence;
- `TC-M6-INT-02` recovery and rolling-compatibility evidence;
- QG-01–QG-10, security/capacity checks, observability, Runbooks, feature flags, and rollback readiness;
- internal/staging soak followed by controlled production observation when traffic exists;
- explicit product, UX, engineering, QA, security, and operations sign-off.

Synthetic fixtures and probes may validate technical behavior. They must never be presented as real-user validation. A lack of Beta users alone is not a No-Go condition; any effective quality, security, integrity, recovery, or rollback failure remains a No-Go.

## Retired original scope

The retired G08 proposal included:

- recruitment rules and a named cohort owner;
- consent, withdrawal, provenance, and privacy records;
- a test-account pool and sample ownership;
- deduplication rules for Trip/activity samples;
- 5%/25% dashboards with fixed real-user and Trip minimums;
- `TC-G08-01` cohort consent schema;
- `TC-G08-02` deduplication and withdrawal;
- `TC-G08-03` gray-gate rehearsal;
- `TC-M6-INT-03` Plan B and gray-sample gate.

These items were not implemented. Their planned file paths and test paths must not be created merely to satisfy historical documentation.

## Reactivation rule

Do not silently reactivate G08. A future user-research or Beta program requires a new, explicitly approved task with:

1. a concrete product question and target cohort;
2. an owner, recruitment channel, consent/privacy basis, retention policy, and withdrawal process;
3. a separate estimate and acceptance criteria;
4. an explicit statement of whether its findings are advisory or a release gate.

The new task should reference this record but use a new task/test ID, leaving G08 permanently Deprecated.

## Traceability

- [`DEVELOPMENT_MILESTONE.md`](../DEVELOPMENT_MILESTONE.md)
- [`DEVELOP_EXECUTION_PLAN.md`](../DEVELOP_EXECUTION_PLAN.md)
- [`DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md)
- [`TEST_CASES.md`](../TEST_CASES.md)
