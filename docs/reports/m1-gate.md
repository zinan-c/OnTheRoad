# M1 development gate

- Status: **M1 Complete for the Dev Track**
- Date: 2026-07-29
- Baseline: macOS arm64, Node 24.14.0, pnpm 9.15.4
- Runtime: native PostgreSQL/PostGIS, authenticated Redis, and native MinIO

## Task commits

| Task | Commit | Result |
|---|---|---|
| C01 | `f0ae058` | Provider contracts and offline fixture |
| A07 | `346ff10` | Traceable, redacted telemetry baseline |
| A05 | `a73b494` | Development identity and owner guards |
| A06 | `a707c53` | Durable job, outbox/inbox, and idempotency skeleton |
| B01 | `7124f36` | Central reference data and seed contract |
| B02 | `78920da` | Owner-scoped Trip and Destination persistence |
| B04 | `8fa1c9e` | Trip wizard and resilient list flow |
| D01 | `25d2c02` | Immutable presigned attachment uploads |
| C03 | `2215abb` | Location state and PostGIS invariants |
| B03 | `3c213d4` | Atomic Trip Day generation and date changes |

G08 was removed before implementation and remains traceable as Deprecated in
[`docs/deprecated/G08-beta-cohort.md`](../deprecated/G08-beta-cohort.md).

## Milestone gate evidence

`TC-M1-INT-01` passed against native PostgreSQL/PostGIS. It verified:

- development-identity login;
- atomic creation of a five-day Trip and all five Days;
- cross-owner access returning the not-found contract;
- persistence and audit recovery through a fresh repository/service instance.

`TC-M1-INT-02` passed against PostgreSQL, authenticated Redis, and a temporary
versioned MinIO bucket. It verified:

- recovery after a database commit and before queue publication;
- recovery after Redis delivery state is cleared;
- one queued event per event ID across reconciliation retries;
- append-only object upload and immutable version/checksum metadata;
- one trace ID linking the API outbox span to a distinct Worker span.

## Verification

- `pnpm run quality`: passed lint, typecheck, unit, and build for all 15
  workspaces.
- `pnpm run test:all:dev`: passed unit, milestone/infrastructure integration,
  MapLibre visual, PDF visual, and clean-install smoke checks.
- M1 native application suite: 10 test files and 15 tests passed without Turbo
  cache, covering PostgreSQL/PostGIS, MinIO, Trip/Day, Location, attachment,
  Web create/reload, and generated-contract checks.
- M1 milestone suite: 2 test files and 2 tests passed.

The final verification also corrected three repository-wide integration
defects exposed by the gate: missing workspace lockfile importers, declaration
emission writing into dependency source trees, and nullable Destination
response fields being dropped by the generated client.

## Release handoff

This result allows M2 work to begin. It is not formal release approval:

- the A05 Staging IdP Track remains blocked on external provider configuration
  and credentials; see
  [`docs/reports/a05-staging-idp-handoff.md`](./a05-staging-idp-handoff.md);
- the A02 Compose parity checks remain mandatory before release; see
  [`docs/runbooks/release-checklist.md`](../runbooks/release-checklist.md).
