# M3 product acceptance and demonstration record

- Milestone: **M3 — Routing, gallery, expenses, and Excel staging**
- Decision: **Accepted for the Dev Track**
- Review date: **2026-08-08 (Asia/Shanghai)**
- Browser re-acceptance: **2026-08-09 — 21/21 passed**
- Product baseline: `565365a` (`fix(m3): close public contract gate`)
- Subsequent technical closure: `10d7c1d03c7a1df579ac37f79b71bbfef5919424`
- Browser implementation baseline: `c0e2e3a4f2ca65e92b33dee1f1a44e3b41ce6b28`
- Signatory role: **Product Owner**
- Signatory: **Codex, acting under the repository owner's explicit instruction**

## Evidence reviewed

The Product Owner reviewed the M3 scope and acceptance criteria in
`docs/DEVELOPMENT_MILESTONE.md`, the executable Case definitions in
`docs/TEST_CASES.md`, the technical Gate report in `docs/reports/m3-gate.md`,
and the machine-readable required-case result. The final exact-SHA rerun is
recorded locally at `test-results/local-m0-m3-required.json` and summarized in
the M3 Gate report; local `test-results/` files are ignored diagnostics and CI
uploads the durable artifact.

The archived Gate result reports:

- 129 expected, collected, executed, and passed Cases;
- zero failed, skipped, or uncollected required Cases;
- successful real PostgreSQL/PostGIS route, expense, gallery, and staging
  integration paths;
- desktop and mobile browser coverage through the production Next.js and
  Nest/Fastify composition roots;
- no managed-schema change during the required-case run.

The public API contract gap found during the post-Gate review was closed by
`565365a`. All M0–M3 public controller routes are now represented in OpenAPI
and the generated client, with bidirectional runtime/contract parity enforced.
The later R&D closure commit `10d7c1d` added commit-bound verification and reran
the complete Gate without changing this Product Owner acceptance decision.

## Acceptance result

| M3 acceptance requirement | Product result | Accepted evidence |
|---|---|---|
| Location, order, or Mode changes synchronously obsolete old routes and rebuild the current generation | Accepted | `TC-C07-01`–`03`, `TC-M3-INT-01` |
| Gallery and expense experiences complete independently and recover after refresh | Accepted | `TC-D03-01`–`03`, `TC-D05-01`–`03`, `TC-M3-INT-01` |
| Excel preview distinguishes new, update, duplicate, error, unresolved, and skipped states without formal Item/Location side effects | Accepted | `TC-E03-01`–`03`, `TC-E04-01`–`03`, `TC-E05-01`–`03`, `TC-M3-INT-02` |
| The E04 staging contract is frozen for M4 consumers | Accepted | `docs/reports/m3-gate.md` contract-freeze section |
| Desktop/mobile and keyboard-relevant M3 interactions are usable | Accepted | Required Playwright desktop/mobile results and M3 component Cases |

No product exception or scope deferral is required for M3.

## Demonstration record

This written record is the archived demonstration record permitted by the
Milestone rule's “recording/record” requirement. Each step is reproducible from
the named automated Case and was accepted based on the recorded Gate result.

1. **Route rebuild:** open a trip containing A→B→C, reorder B and A, observe
   the old active segments disappear before the replacement route is generated,
   then confirm the current B→A segment. Evidence: `TC-M3-INT-01` and
   `TC-C07-03`.
2. **Route presentation:** display flight, walking, ferry, transit, and custom
   modes; confirm distinct line/icon/text treatment and actual/approximate/manual
   quality disclosure. Evidence: `TC-C08-01`–`03`.
3. **Map/timeline interaction:** select a timeline card and observe its marker;
   select a marker and return focus to the corresponding card; repeat on mobile
   and after fullscreen restoration. Evidence: `TC-C09-01`–`03`.
4. **Gallery:** upload multiple real images, observe processing state, change
   caption/order/day cover, open the lightbox, delete one entry, and reload.
   Evidence: `TC-D03-01`–`03` and `TC-M3-INT-01`.
5. **Expenses:** enter CNY and USD expenses and a manual exchange rate; reconcile
   day, destination, category, transport-mode, and original-currency totals.
   Evidence: `TC-D05-01`–`03` and `TC-M3-INT-01`.
6. **Excel staging:** upload a mixed Chinese/English workbook, edit the mapping,
   inspect normalized values and a field-level error in a 5,000-row preview,
   then confirm the formal Item and Location counts remain unchanged. Evidence:
   `TC-E03-01`–`03`, `TC-E04-01`–`03`, `TC-E05-01`–`03`, and `TC-M3-INT-02`.

## Product sign-off

I accept the M3 integration-test result, the M3 acceptance result, and the
demonstration record above for the Dev Track. The implemented behavior matches
the stated M3 product boundary: routing, gallery, and expenses form usable
loops, while Excel remains an auditable staging preview and does not claim to
have committed formal itinerary facts.

This acceptance does not approve a production release. Real HERE Routing,
Staging IdP, and Compose/Linux parity remain governed by the release checklist.

**Product Owner signature:** `PROD-M3-ACCEPTED-2026-08-08-565365a`

## 2026-08-09 browser acceptance addendum

The complete product-browser acceptance matrix in
`docs/E2E_AUTOMATION_CASES.md` was executed after the product entry-point and
runtime integration work was completed. E2E-001 through E2E-021 all passed:
**21 passed, 0 failed, 0 skipped**.

The run covered the documented manual workflows without API-created business
results: Trip creation/settings/list/trash, Item creation/edit/copy/delete and
ordering, explicit Location confirmation and coordinate editing, custom Modes,
DirectionsProvider/Worker/Route API/MapLibre, Gallery, multi-currency Expenses
and rates, three-format server Import Preview, and shared Reference Data.

The accepted implementation is commit
`c0e2e3a4f2ca65e92b33dee1f1a44e3b41ce6b28`. This addendum confirms that the
formerly `Partial` and `Critical gap` cases are now product-browser `Passed`.
It supplements rather than rewrites the original 2026-08-08 sign-off and does
not approve production release-only checks.

**Product browser re-acceptance:** `PROD-M3-E2E-21-PASS-2026-08-09-c0e2e3a`
