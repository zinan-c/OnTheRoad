# M2 development gate

- Status: **M2 Complete for the Dev Track**
- Date: 2026-07-30
- Baseline: macOS arm64, Node 24.14.0, pnpm 9.15.4
- Runtime: native PostgreSQL 17/PostGIS, native MinIO, ClamAV, and
  ImageMagick

## Task commits

| Task | Commit | Result |
|---|---|---|
| B06 | `48fd4f0` | Daily itinerary editor |
| D02 | `058ce79` | Quarantined media processing and immutable ready objects |
| E01 | `477ef97` | Versioned Excel import template |
| C05 | `0c096f7` | Resilient MapLibre itinerary map |
| C04 | `866bf08` | Recoverable location candidate input |
| C02 | `f816cc8` | Policy-safe HERE geocoder |
| B05 | `b368f69` | Full itinerary item lifecycle |
| B09 | `09bf91a` | Trip-scoped transport modes |
| B08 | `2a8ddb0` | Resilient itinerary autosave |
| D04 | `fcad839` | Expense and exchange-rate service |
| B07 | `f7c607d` | Atomic itinerary reordering |
| C06 | `72e7503` | Durable map coordinate adjustment |
| E02 | `d8fb2ff` | Safe workbook inspection entry |

## Milestone gate evidence

`TC-M2-INT-01` passed against native PostgreSQL/PostGIS from an empty
development account. It created the fixed five-day Trip through the real Trip
service and then exercised the B05, B06, B07, and B08 service/repository path.
The test verified:

- create, update, copy, and soft-delete for a complete day;
- mouse, touch, and keyboard reorder through the dnd-kit integration;
- atomic reorder rollback on a real version conflict;
- autosave and final ordering recovery through a fresh repository instance.

`TC-M2-INT-02` passed with the fixed location fixture and an empty location
repository. It connected C02, C03, C04, C05, and C06 and verified:

- same-name HERE candidates are never selected silently;
- the selected candidate crosses the server-signed confirmation boundary;
- map pick and drag persist the final manual coordinate;
- a late geocode result cannot overwrite the manual coordinate;
- the MapLibre marker renders the final persisted coordinate.

The HERE response in this deterministic development gate was supplied through
the injected provider transport. No external HERE request or credential was
used, and the production adapter still requires only `OTR_HERE_API_KEY`.

`TC-M2-INT-03` passed through the real media/import job entry points. It
verified:

- a benign image can progress from quarantine to `ready`;
- an EICAR workbook fails malware scanning and cannot queue inspection;
- the versioned template and xlsx/xls/csv fixtures are scanned before isolated
  workbook inspection;
- inspection returns metadata only and creates no staging or formal itinerary
  items.

## Architecture and security delta review

### Module boundaries

- The Gate exposed and corrected a build-time boundary violation where Web
  imported application source by repository path.
- Location application contracts are now exported by the formal
  `@on-the-road/application` workspace package and consumed by API and Web
  through that package boundary.
- M2 does not add an app-to-app production import or a new deployable service.
  Media and import work remain durable Worker jobs behind the application
  contracts defined in M1.

### Provider, file, and network attack surface

- HERE remains the only production geocoder. It uses an API key, applies
  timeout/response limits, redacts secrets and full addresses, and does not
  silently switch provider. Provider identifiers cross the client boundary
  only in signed confirmation tokens.
- The deterministic fixture transport is a development/test adapter, not a
  release fallback. A controlled real-provider smoke remains a staging
  checklist item requiring the external credential and explicit network
  approval.
- Media stays unreadable in quarantine until malware scan, magic-byte
  validation, bounded ImageMagick processing, and immutable object-version
  checks succeed. Scanner failure is fail-closed.
- Workbook inspection accepts only xlsx/xls/csv with matching extension and
  MIME evidence. Clean-scan evidence is bound to the immutable object
  version/checksum, parsing runs in an isolated Worker with time and memory
  limits, and formulas are treated as inert input. E02 accepts no remote URL
  and writes neither import staging rows nor formal itinerary items.

### State machines and concurrency

- Item mutations remain owner-scoped, versioned, and soft-delete aware.
  Reorder is one atomic database operation and emits one ordered fact only
  after every requested item and version has been validated.
- Autosave keeps one queued draft, exposes conflict state, and never reports a
  failed or stale write as saved.
- Location confirmation requires explicit candidate selection. Coordinate
  adjustment uses compare-and-set semantics and writes its audit record in the
  same transaction; manual coordinates win over late geocode results.
- Media can reach `ready` only from a successfully verified processing path.
  Import inspection can reach its success state only from immutable,
  owner-matched, clean source evidence.
- Expenses use fixed-decimal storage. Missing exchange rates remain explicit
  and unconverted; route estimates are outside the M2 persisted-expense
  contract.

### Plan B review

No M2 implementation changes the documented Plan B boundaries:

- geocoding failure pauses automatic location writes and leaves explicit
  candidate selection or manual placement available; it never switches
  provider silently;
- media scanner/processor failure pauses new processing while existing ready
  objects and text editing remain available;
- unsafe or permanently invalid workbooks stop with an actionable error and
  are not retried into staging; users may return to the versioned template or
  CSV path;
- reorder or autosave conflict rolls back and reloads authoritative state
  before the user retries.

The review found no unresolved Critical or High security defect. No Medium
security exception is being carried from M2.

## Verification

- `pnpm run quality`: passed lint, typecheck, unit, and build for all 17
  workspaces.
- `pnpm run test:all:dev`: passed unit, integration, MapLibre E2E/visual, PDF
  visual, and clean-install smoke checks.
- `pnpm run ci:smoke`: 1 test file and 2 tests passed in a clean workspace
  installation check.
- M2 milestone suite: 3 test files and 3 tests passed in one invocation.
- Task-level persistence and security suites exercised PostgreSQL/PostGIS
  constraints for item lifecycle, reorder, coordinate audit, expenses, and
  workbook inspection, plus native media quarantine and malware evidence.

## Release handoff

This result allows M3 work to begin on the Dev Track. It is not formal release
approval:

- a controlled real HERE staging smoke still requires the deployment
  credential and explicit network approval;
- the A05 Staging IdP Track remains a pre-release requirement;
- A02 Compose parity remains a pre-release checklist item rather than a
  development gate; see
  [`docs/runbooks/release-checklist.md`](../runbooks/release-checklist.md).
