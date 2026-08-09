# Documentation status index

This page is the canonical entry point for current milestone maturity. Design,
plans, historical Gate reports, and review findings retain their original dates
and context; this index states what the repository currently claims.

## Current milestone status

| Milestone | Implemented | Runtime-integrated | CI/required-case verified | Production release verified | Evidence |
|---|---|---|---|---|---|
| M0 | Yes | Yes | Yes | No — release gates are separate | [`reports/a02-native-gate.md`](./reports/a02-native-gate.md) and Spike reports |
| M1 | Yes | Yes | Yes | No — A02/A05 release items remain | [`reports/m1-gate.md`](./reports/m1-gate.md) |
| M2 | Yes | Yes | Yes | No — A02/A05 release items remain | [`reports/m2-gate.md`](./reports/m2-gate.md) |
| M3 | Yes | Yes | Yes — 129/129 closure Gate plus 21/21 product-browser re-acceptance | No — A02/A05 and real-provider checks remain | [`reports/m3-gate.md`](./reports/m3-gate.md), [`reports/m3-product-acceptance.md`](./reports/m3-product-acceptance.md), [`reports/m3-rnd-final-review.md`](./reports/m3-rnd-final-review.md), [`E2E_AUTOMATION_CASES.md`](./E2E_AUTOMATION_CASES.md) |
| M4–M6 | Planned | No | No | No | [`DEVELOPMENT_MILESTONE.md`](./DEVELOPMENT_MILESTONE.md) |

“Done for the Dev Track” means implemented, assembled through production
composition roots, and verified by the required development Gate. It does not
mean release-verified. The unchecked items in
[`runbooks/release-checklist.md`](./runbooks/release-checklist.md) remain
blocking for a production release.

## Authoritative documents

| Question | Source |
|---|---|
| Product and architecture decisions | [`DESIGN.md`](./DESIGN.md) and [`adr/`](./adr/) |
| Task scope, acceptance, risks, and milestone boundaries | [`DEVELOPMENT_MILESTONE.md`](./DEVELOPMENT_MILESTONE.md) |
| Delivery model and implementation details | [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md) |
| Task ordering, locks, and handoff protocol | [`DEVELOP_EXECUTION_PLAN.md`](./DEVELOP_EXECUTION_PLAN.md) |
| Executable Case IDs and Gate rules | [`TEST_CASES.md`](./TEST_CASES.md) |
| M0–M3 product-browser acceptance cases and current status | [`E2E_AUTOMATION_CASES.md`](./E2E_AUTOMATION_CASES.md) |
| Post-M2 findings and remediation history | [`CODE_REVIEW.md`](./CODE_REVIEW.md) |
| Runtime configuration and telemetry | [`configuration.md`](./configuration.md) and [`observability.md`](./observability.md) |
| Local operation and release-only checks | [`runbooks/local-stack.md`](./runbooks/local-stack.md) and [`runbooks/release-checklist.md`](./runbooks/release-checklist.md) |

## Evidence rules

- Current M0–M3 required Cases are defined by
  `test-manifests/m0-m3.required.json` and checked against this documentation
  and executable test files.
- `pnpm run test:cases:required` writes the configured machine-readable report;
  `pnpm run test:cases:evidence` accepts it only when it is passed, clean,
  bound to the exact 40-character closure SHA, running the pinned Node version,
  and contains no failed, skipped, todo, or uncollected required Case.
- Local reports under `test-results/` are ignored diagnostics. GitHub artifacts
  are the durable CI copy; narrative Gate reports summarize the accepted result
  but do not replace the machine-readable evidence.
- Historical reports keep the toolchain and environment that were actually
  used at the time. The current supported toolchain is always the root
  `.nvmrc` and `packageManager` pair.
- The current product-browser suite is `pnpm run test:e2e`. Its accepted
  2026-08-09 run executed E2E-001 through E2E-021 with 21 passed, zero failed,
  and zero skipped against implementation commit
  `c0e2e3a4f2ca65e92b33dee1f1a44e3b41ce6b28`.

## Maintenance rule

Every milestone closure must update this page and the root README, add or amend
its Gate report, update the required-case manifest and `TEST_CASES.md`, and
state any residual release-only obligations without converting them into Dev
successes.
