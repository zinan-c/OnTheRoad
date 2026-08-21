# Documentation status index

This page is the canonical entry point for current milestone maturity. Design,
plans, historical Gate reports, and review findings retain their original dates
and context; this index states what the repository currently claims.

## Current milestone status

| Milestone | Implemented | Runtime-integrated | CI/required-case verified | Production release verified | Evidence |
|---|---|---|---|---|---|
| M0 | Yes | Yes | Yes | No — release gates are separate | [`reports/a02-native-gate.md`](./reports/a02-native-gate.md) and Spike reports |
| M1 | Yes | Yes | Yes | No — A02 release parity/A05 release items remain | [`reports/m1-gate.md`](./reports/m1-gate.md) |
| M2 | Yes | Yes | Yes | No — A02 release parity/A05 release items remain | [`reports/m2-gate.md`](./reports/m2-gate.md) |
| M3 | Yes | Yes | Yes — 129/129 closure Gate plus 22/22 product-browser re-acceptance | No — A02 release parity, A05, and real-provider checks remain | [`reports/m3-gate.md`](./reports/m3-gate.md), [`reports/m3-product-acceptance.md`](./reports/m3-product-acceptance.md), [`reports/m3-rnd-final-review.md`](./reports/m3-rnd-final-review.md), [`E2E_AUTOMATION_CASES.md`](./E2E_AUTOMATION_CASES.md) |
| M4 | Yes — Dev Track complete | Yes — real Compose/API/Worker/PDF Worker path passed | Yes — 156/156 required Cases passed on the closure SHA | No — production release gates remain separate | [`reports/m4-gate.md`](./reports/m4-gate.md) |
| M5–M6 | Planned | No | No | No | [`DEVELOPMENT_MILESTONE.md`](./DEVELOPMENT_MILESTONE.md) |

“Done for the Dev Track” means implemented, assembled through production
composition roots, and verified by the required development Gate. It does not
mean release-verified. The unchecked items in
[`runbooks/release-checklist.md`](./runbooks/release-checklist.md) remain
blocking for a production release.

## Current gate status

- **A02 development gate:** Complete as of 2026-08-11. Native Track and local
  Compose evidence are archived in [`reports/a02-native-gate.md`](./reports/a02-native-gate.md).
- **A02 release parity:** Open. Clean CI/staging image pulls, release-SHA
  artifacts, and formal Linux/Compose parity are still required.
- **M3 Dev Track:** Complete; the required-case Gate is 129/129 and the latest
  product-browser regression is 22/22. M3 production release approval remains
  separate from A02/A05 and real-provider checks.
- **M4 Dev Track:** Complete on closure SHA `82c3de5`; the real
  Compose/API/Worker/PDF Worker run passed with 156/156 required Cases,
  commit-bound evidence, PDF Worker round-trip, and clean-checkout smoke.
  Production release approval remains separate. See
  [`reports/m4-gate.md`](./reports/m4-gate.md).
- **Post-M4 Online Map Workstream:** Planned/open. The target is online
  Nominatim search/reverse, online tiles, and an independent non-HERE
  Directions endpoint in `dev`/`qa`/`prod`; the required-case suite remains
  fixture-backed until the online smoke gate is implemented.

## Current map-provider decision

The active architecture no longer selects HERE. `international_primary` uses
public online Nominatim through the API proxy; `hybrid` uses AMAP in China and
Nominatim overseas. Local development uses the same online `dev` profile as
the application runtime; `dev`, `qa`, and `prod` use online geocoding and map
runtime by default. `fixture` remains an explicit CI/offline profile. Tiles
and Directions are separate online capabilities and are not provided by
Nominatim; the Directions provider still requires its own implementation and
real-provider gate. See [`ADR-003`](./adr/003-online-nominatim-map-runtime.md)
and the [migration plan](./reports/nominatim-online-plan.md).

## Authoritative documents

| Question | Source |
|---|---|
| Product and architecture decisions | [`DESIGN.md`](./DESIGN.md) and [`adr/`](./adr/) |
| Task scope, acceptance, risks, and milestone boundaries | [`DEVELOPMENT_MILESTONE.md`](./DEVELOPMENT_MILESTONE.md) |
| Delivery model and implementation details | [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md) |
| Task ordering, locks, and handoff protocol | [`DEVELOP_EXECUTION_PLAN.md`](./DEVELOP_EXECUTION_PLAN.md) |
| Executable Case IDs and Gate rules | [`TEST_CASES.md`](./TEST_CASES.md) |
| M0–M3 product-browser acceptance cases and current status | [`E2E_AUTOMATION_CASES.md`](./E2E_AUTOMATION_CASES.md) |
| Current full-project review (2026-08-18) | [`reviewer/CODE_REVIEW_0818.md`](./reviewer/CODE_REVIEW_0818.md) |
| Post-M2 findings and remediation history | [`reviewer/CODE_REVIEW.md`](./reviewer/CODE_REVIEW.md) |
| Runtime configuration and telemetry | [`configuration.md`](./configuration.md) and [`observability.md`](./observability.md) |
| Local operation and release-only checks | [`runbooks/local-stack.md`](./runbooks/local-stack.md) and [`runbooks/release-checklist.md`](./runbooks/release-checklist.md) |

## Evidence rules

- Current M0–M4 required Cases are defined by
  `test-manifests/m0-m4.required.json` and checked against this documentation
  and executable test files. The historical M3 closure remains recorded by
  `test-manifests/m0-m3.required.json` and `reports/m3-gate.md`.
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
- Historical M0–M3 reports may mention HERE because it was the Provider under
  test at that time. Those mentions are evidence only; they do not override
  the current online Nominatim decision in [`adr/003-online-nominatim-map-runtime.md`](./adr/003-online-nominatim-map-runtime.md).
- The current product-browser suite is `pnpm run test:e2e`. Its accepted
  2026-08-11 run executed E2E-001 through E2E-022 with 22 passed, zero failed,
  and zero skipped. E2E-022 covers the Global/Day map-scope and stable
  MapLibre sizing regression fixed by the accompanying implementation commit.
  GitHub runs this suite independently in `CI-Product E2E`; it is not a job
  dependency of `CI-Test Cases`.
- The M4 required-case runner includes 156 active Cases: the 129 historical
  M0–M3 Cases, 24 M4 Task Cases, and three M4 integration Cases. A configured
  manifest is not closure evidence until the exact-SHA run has zero failed,
  skipped, todo, or uncollected Cases. The accepted closure run is
  `82c3de537e67501d761e2c107a011cc32bf009d9` with 156/156 passed.

## Maintenance rule

Every milestone closure must update this page and the root README, add or amend
its Gate report, update the required-case manifest and `TEST_CASES.md`, and
state any residual release-only obligations without converting them into Dev
successes.
