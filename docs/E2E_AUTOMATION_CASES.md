# On The Road Automated Happy-Path Cases

> Document status: Review Draft
>
> Scope: planned and implemented M0–M3 product capabilities
>
> Case count: 22
>
> Execution: every case can be run by Playwright or accepted manually with the same steps
>
> Current result: **22/22 passed, 0 failed, 0 skipped** on 2026-08-11 (Asia/Shanghai), using Playwright Chromium against the real Web/API/Worker stack and PostgreSQL/PostGIS. E2E-022 adds the Global/Day map-scope and stable MapLibre sizing regression path in this bug-fix commit.
>
> Boundary: this result closes the M0–M3 browser acceptance cases defined here. M4–M6 features and production release gates remain outside the completion claim.

> Online map boundary: `cn_primary` uses official AMap Search/Reverse, Web JS
> 2.0 layers, Directions and Static Map. The deterministic browser suite in
> this document remains fixture-backed; online provider checks are separate
> controlled smoke cases and do not change the historical 22/22 result.

## 1. Purpose

This document defines the happy-path automation baseline for On The Road, covering clean startup, identity, Trips, Days, Itinerary Items, Locations, map routes, images, expenses, and Excel staging. Cases primarily verify that a user can complete an operation in the real product UI, then confirm the business facts through public APIs, persisted results, and observable evidence.

It specifically avoids these false conclusions:

- A passing component test does not mean that the component is integrated into the product page.
- Calling a Service or Repository directly, or writing the database, is not a user-path E2E test.
- A clickable SVG illustration does not prove that a real MapLibre map and routes work.
- Fixtures may replace external network responses, but may not bypass the production Directions Provider contract, Worker, API, or UI path.
- A fully green case count does not mean that Milestone Scope not covered by these cases is complete.

## 2. Common acceptance baseline

### 2.1 Runtime environment

Unless a case says otherwise, every case uses the same real stack:

- Next.js Web;
- NestJS/Fastify API;
- PostgreSQL with PostGIS;
- authenticated Redis;
- BullMQ Worker;
- MinIO or equivalent S3-compatible object storage;
- ClamAV and ImageMagick;
- Chromium, with 1440 × 900 as the desktop baseline and Pixel 7 as the mobile baseline;
- deterministic local Geocoding, Directions, and Tile fixtures under `MAP_PROFILE=fixture`, injected through the production runtime dependency path and called through public interfaces.

### 2.2 Operation boundaries

- Business actions under acceptance must originate from the browser UI.
- Public APIs may prepare data outside a case's acceptance focus, but every such prerequisite must be reported.
- Direct SQL writes may not manufacture an accepted result.
- Read-only APIs or read-only SQL may verify evidence after an operation.
- Every case uses an independent owner, Trip name, and Idempotency-Key.
- A case must clean up its own data, or run in an isolated database that is destroyed after the suite.

### 2.3 Automation evidence

Every case archives at least:

- Playwright trace;
- screenshot and video on failure;
- full current Git SHA;
- Node, pnpm, browser, and migration versions;
- API `traceId` or request correlation information;
- a summary of created Trip, Job, Attachment, and other entity IDs;
- a Provider fixture call summary without cookies, secrets, signed URLs, or full sensitive addresses;
- final assertion count and details of failed assertions.

### 2.4 Status definitions

| Status | Meaning | Acceptance handling |
|---|---|---|
| `Passed` | The complete browser path passed against the real development stack | Retain the executable case as a regression gate; any later failure is a product regression |
| `Ready` | The current product page has the main entry points and a browser test can be written from the reviewed code | The case must pass; failure is a product regression |
| `Partial` | API, domain logic, or components exist, but the current page lacks an entry point or complete integration | Keep the target case; record the product gap instead of weakening assertions |
| `Critical gap` | A core M3 product path is absent or conflicts with acceptance semantics | The affected Milestone may not be signed off until the case passes |

### 2.5 Overall completion

- All 22 cases are `Passed`, with zero failures and zero skips in the accepted run.
- Former `Partial` product entry-point gaps are closed by real UI workflows; no accepted business write is API-seeded.
- E2E-016 and E2E-017 passed as mandatory route/map re-acceptance cases.
- Automation may use fixture Providers, but Staging/Release still requires separate smoke tests against official AMap Search/Reverse, JS runtime, Directions and Static Map. CI must never call public map services.

---

## E2E-001 — Clean-stack readiness and capability discovery

- **Status**: `Passed`
- **Coverage**: M0; A01–A04, A06–A07, A12; M1 base runtime
- **Goal**: prove that a clean environment reaches a genuinely usable state and that homepage capabilities match backend facts.

### Preconditions and data

- Use an empty isolated data directory or a fresh CI environment.
- Do not pre-create the database schema, bucket, or Redis keys.
- Use a valid Dev Profile and fixture Provider configuration.

### Manual steps

1. Run `pnpm run dev` as described in the README (Native is the default; use
   `pnpm run dev -- -native` explicitly when needed).
2. Wait for explicit API, Web, and Worker-heartbeat readiness output.
3. Open the Web URL printed by `pnpm run dev` (normally
   `http://127.0.0.1:18100/`); the same output includes API live/ready/base URLs.
4. Inspect service status and the Location search, Excel, and other capability text.
5. Visit `/health/live`, `/health/ready`, `/api/v1/system/reference-data`, and `/api/v1/system/capabilities`.
6. Refresh the homepage once and confirm that service status does not regress to an error state.

### Automation requirements

- Start the stack only once; the runner may not silently restart the API or Worker after readiness failure.
- Record migration status, Reference Data counts, and Worker heartbeat time.
- Browser assertions must run against the real Web server, not a static HTML fixture.

### Detailed checks

- `/health/live` succeeds and reports process liveness only.
- `/health/ready` succeeds only when PostgreSQL, Redis, Object Storage, ClamAV, and required configuration are available.
- Migrations have no pending, dirty, checksum-drift, or unknown versions.
- Reference Data contains at least 15 currencies, 9 expense categories, and 22 system transport modes.
- Homepage capability text matches `/system/capabilities`; a `false` capability is not shown as available.
- API, Web, and Worker structured logs contain correlatable service names and trace/request context.
- The page has no unhandled exception, hydration error, or continuously failing network request.

### Acceptance baseline

Every assertion must pass without an automatic restart, skipped dependency, or stale schema.

---

## E2E-002 — Development login, session persistence and re-login

- **Status**: `Passed`
- **Coverage**: M1; A05; identity, cookies, and owner session
- **Goal**: verify browser development login, refresh persistence, logout, and re-login end to end.

### Preconditions and data

- Dev Profile, using the Web URL printed by `pnpm run dev`, with the API configured to allow that exact local origin.
- Pre-create a Trip owned by `browser-demo-owner`, or run E2E-003 first.

### Manual steps

1. Clear site cookies and directly open the Trip detail URL.
2. Confirm that the page shows “Signed out,” rather than a blank page or generic 500.
3. Click “Log in again.”
4. Wait for Trip detail to load.
5. Refresh twice and open the same Trip in a new same-origin tab.
6. Click “Log out.”
7. Refresh and confirm that the signed-out state persists.
8. Click “Log in again” and confirm that access to the original Trip is restored.

### Automation requirements

- Do not pre-inject authentication through Playwright `storageState`.
- Actually call the development-session endpoint and let the browser manage cookies.
- Never read or print cookie values; observe authentication results only.

### Detailed checks

- An unauthenticated protected Trip enters the signed-out UI state and the protected API returns 401.
- After Development Session creation, `GET /identity/session` returns the current principal.
- The browser stores the cookie in HTTP Dev; refresh and a same-origin tab retain the session.
- After logout, the old cookie no longer authorizes access.
- Re-login does not create another Trip or change the original owner.
- Logs, traces, error pages, and test artifacts contain no session token.

### Acceptance baseline

Login, two refreshes, logout, refresh, and re-login all succeed, with UI and API authentication states aligned.

---

## E2E-003 — Standard five-day multi-destination Trip creation

- **Status**: `Passed`
- **Coverage**: M1; B01–B04; atomic Trip/Day creation
- **Goal**: verify the representative five-day, multi-destination Trip happy path.

### Data matrix

| Field | Input |
|---|---|
| Trip name | Shanghai and Zhoushan in Five Days |
| Start date | 2026-10-01 |
| End date | 2026-10-05 |
| Destinations | Shanghai, Zhoushan |
| Travelers | 2 |
| Default currency | CNY |
| Expected timezone | Asia/Shanghai |
| Expected mapProfile | cn_primary |

### Manual steps

1. Click “Create my Trip” on the homepage.
2. Clear the default name and enter “Shanghai and Zhoushan in Five Days.”
3. Select the start and end dates.
4. Confirm that the page immediately says “A 5-day plan will be generated.”
5. Enter “Shanghai, Zhoushan” as destinations.
6. Enter 2 travelers and select CNY.
7. Click “Create Trip” and observe the button change to “Creating…”.
8. Wait for navigation to `/trips/{tripId}`.
9. Record the Trip ID and refresh.

### Automation requirements

- Locate all form fields by accessible labels.
- Do not write Destinations or Days directly after creation.
- The public API may read back the complete Trip and Days for verification.

### Detailed checks

- Development Session and Trip creation return 201.
- The button is disabled during creation and no duplicate request is sent.
- The URL Trip ID matches the API response ID.
- Name, dates, travelers, defaultCurrency, timezone, and mapProfile are correct.
- Exactly two Destinations exist in Shanghai, Zhoushan order, both with countryCode CN.
- Five consecutive Days are generated with dayNumber 1–5 and dates October 1–5.
- Trip and Days have the same owner; creation is atomic, with no partially successful Day state.
- Name, dates, and Day count survive refresh.

### Acceptance baseline

One browser submission creates exactly one complete Trip; any lost field, incorrect Day count, or refresh loss fails the case.

---

## E2E-004 — Single-day minimum-value Trip

- **Status**: `Passed`
- **Coverage**: M1; B02–B04; minimum valid date and traveler boundaries
- **Goal**: prove that a one-day, one-destination, one-person Trip is a complete valid path.

### Data matrix

| Field | Input |
|---|---|
| Trip name | Tokyo Day Walk |
| Start date | 2026-11-08 |
| End date | 2026-11-08 |
| Destination | Tokyo |
| Travelers | 1 |
| Default currency | USD, proving that the selection is persisted |

### Manual steps

1. Open the new-Trip page.
2. Fill in the matrix values.
3. Confirm “A 1-day plan will be generated.”
4. Submit and enter Trip detail.
5. Refresh and read the Day list.

### Detailed checks

- Equal start and end dates are accepted.
- Exactly one Day is generated and its date equals the Trip date.
- `totalDays=1`, `travelers=1`, and Destination count is 1.
- defaultCurrency is the selected value and does not fall back to CNY.
- No Day 0, Day 2, or duplicate Day is generated.
- The Trip loads normally after refresh.

### Acceptance baseline

The single-day Trip uses the same production creation path as a multi-day Trip, without mocks or frontend-only state.

---

## E2E-005 — Leap-date, mixed destination delimiters and maximum form values

- **Status**: `Passed`
- **Coverage**: M1; B01–B04; valid creation-form boundaries
- **Goal**: verify leap-year dates, mixed Chinese delimiters, maximum browser traveler count, and a non-default currency.

### Data matrix

| Field | Input / expected |
|---|---|
| Trip name | East China Leap-Year Cross-Month Trip |
| Dates | 2028-02-28 through 2028-03-01; 3 days expected |
| Raw destinations | `Shanghai, Hangzhou，Zhoushan、Nanjing` |
| Expected destinations | Shanghai, Hangzhou, Zhoushan, Nanjing |
| Travelers | 99 |
| Default currency | JPY |

### Manual steps

1. Enter the Trip name.
2. Select 2028-02-28, then 2028-03-01.
3. Confirm that the page calculates three days, not two.
4. Enter the mixed-delimiter destination text unchanged.
5. Enter 99 travelers and select JPY.
6. Submit, enter detail, and refresh.

### Detailed checks

- Days are February 28, February 29, and March 1.
- Destinations split correctly on comma, Chinese comma, and ideographic comma.
- Each destination is trimmed, order is retained, and no empty Destination is created.
- travelers is exactly 99 and defaultCurrency exactly JPY.
- UI and API/database dates match without timezone shifting.

### Acceptance baseline

Date, destination, and traveler boundaries all pass together; any silent rewrite fails the case.

---

## E2E-006 — Duplicate submit and idempotent Trip creation

- **Status**: `Passed`
- **Coverage**: M0/M1; A04, B02, B04; idempotency
- **Goal**: prevent duplicate Trips under double-click, slow response, and lost response conditions.

### Preconditions and data

- Use E2E-003 data with a unique case suffix.
- Automation may delay the first response, but may not fabricate server success.

### Manual steps

1. Fill and submit a Trip under a slow network condition.
2. Immediately try clicking the button again and pressing Enter.
3. After navigation, return to the homepage or Trip list and check the record count.
4. Replay the same Idempotency-Key in developer tools to simulate a safe retry after the first response was lost.

### Detailed checks

- Once submission starts, the button cannot be clicked and Enter sends no second browser request.
- Replaying the same owner, Idempotency-Key, and payload returns the same Trip.
- The database contains one Trip, one Destination set, and one Day set.
- Only a different Idempotency-Key may create a new Trip.
- An idempotent response loses no fields and returns the same ETag/version.

### Acceptance baseline

Slow response, double-click, and same-key retry create no duplicate business fact.

---

## E2E-007 — Trip date extension and empty-Day contraction

- **Status**: `Passed` — the former Trip date-editor, preview, and confirmation entry-point gap is resolved.
- **Coverage**: M1/M2; B03, B05; Day-retention rules
- **Goal**: verify that extension retains existing Days/Items and contraction removes only empty Days.

### Preconditions and data

- Create a three-day Trip from 2026-10-01 through 2026-10-03.
- Create one Item on Day 1 and one on Day 2 through the product UI.

### Manual steps

1. Open Trip settings or the date editor.
2. Change the end date to 2026-10-05 and preview the change.
3. Confirm, apply, and refresh.
4. Record Day 1/2/3 IDs and Items.
5. Change the end date back to 2026-10-03.
6. Confirm that only empty Days 4/5 are removed, then refresh again.

### Detailed checks

- Extension adds Days 4/5 without changing existing Day IDs.
- Day 1/2 Item IDs, versions, fields, and order remain unchanged.
- Contraction removes Days 4/5 and retains Days 1–3.
- `totalDays`, endDate, and Day count always agree.
- No orphan Item, Expense, Attachment, or RouteSegment remains.
- The accepted run used the date UI; a direct Service call cannot pass the case.

### Acceptance baseline

The complete browser path now passes without losing business facts.

---

## E2E-008 — Trip update, soft delete and restore lifecycle

- **Status**: `Passed` — the former Trip settings, active/deleted list, and restore-control gaps are resolved.
- **Coverage**: M1; B01–B04; Trip lifecycle and owner/version
- **Goal**: verify that updating basic Trip properties, soft-deleting, and restoring preserve related facts.

### Data matrix

- Name: “Trip to Edit” → “Confirmed Trip”.
- Description: mixed Chinese and English text.
- travelers: 2 → 4.
- budget: `12000.50`.
- defaultCurrency: CNY → EUR.
- timezone: `Asia/Shanghai`.
- mapProfile: keep the explicitly selected value; Provider failure may not silently rewrite it.

### Manual steps

1. Create a Trip and at least one Item.
2. Open Trip settings, enter the update data, and save.
3. Refresh and confirm the update.
4. Delete the Trip from its action menu and confirm.
5. Open the Trip list and confirm that the default list no longer shows it.
6. Open Deleted/Trash and restore it.
7. Return to the Trip and refresh.

### Detailed checks

- Each update uses the current ETag/version; version increases monotonically after success.
- Every changed field is fully persisted.
- Deletion is soft; related Days, Items, Locations, and Expenses are not physically deleted.
- The default list excludes deleted Trips and the restore view finds the Trip.
- Restoration keeps the original Trip, Day, and Item IDs.
- Restoration creates no duplicate Day or RouteSegment.

### Acceptance baseline

UI-driven update, delete, list verification, and restore all pass.

---

## E2E-009 — Complete Itinerary Item type and field matrix

- **Status**: `Passed` — Item Editor is integrated and all six Item types pass through the UI.
- **Coverage**: M2; B05–B06, D04; complete Item model
- **Goal**: cover every Item type and core field through the product editor.

### Data matrix

| Type | Key input |
|---|---|
| Activity | 09:00, 60 minutes, target, description, note |
| Attraction | morning, Oriental Pearl Tower, confirmed Location |
| Dining | 12:00–13:15, restaurant, lunch, booking and contact details |
| Hotel | 22:30–07:30 next day, crosses midnight, check-in/out, king room |
| Transport | 14:00–15:00, Start/End Location, METRO, booking number |
| Other | unscheduled, free time |

### Manual steps

1. Open Day 1 and click Add Item.
2. Select each of the six Item types and fill every field in the matrix.
3. After each save, return to the timeline and confirm that the new Item appears last.
4. Open every Item detail and verify its fields.
5. Refresh, then open and verify every Item again.

### Automation requirements

- Business creation must use the UI; a read-only API may verify response DTOs.
- For sensitive booking/contact data, verify correct display and encrypted-storage flags without printing ciphertext or plaintext to logs.

### Detailed checks

- All six types produce distinct Item IDs without incorrect type mapping.
- clock, period, range, unscheduled, and cross-midnight semantics are correct.
- duration, description, remark, dining, accommodation, and transport fields persist completely.
- Dining links restaurant information; Hotel retains check-in/out; Transport has a Mode.
- Fields, order, and version remain consistent after refresh.
- If the Trip page lacks Item Editor, fail with a UI integration gap.

### Acceptance baseline

All six Items must be created in the browser and restored after refresh; API seeding cannot replace the business operation.

---

## E2E-010 — Item edit, autosave and reload

- **Status**: `Passed` — Item editing, autosave states, reload persistence, and leave warning pass through the product page.
- **Coverage**: M2; B05, B06, B08; editing and autosave
- **Goal**: verify that browser save status and final persisted facts agree during continuous editing.

### Manual steps

1. Open an existing Attraction Item.
2. Change target, description, start/end time, duration, Location, expense, and note.
3. Observe saving/saved status after each input.
4. Rapidly change the description three times, ending with “Final description.”
5. Wait for save completion and refresh.
6. Reopen the Item.

### Detailed checks

- The UI may not show saved before a request is sent.
- Rapid input may coalesce requests, but final server content is “Final description.”
- An older response never overwrites a newer value.
- Version grows with actual submissions and no infinite save loop occurs.
- Every field matches the last confirmed content after refresh.
- Leaving with unsubmitted changes shows a leave warning.

### Acceptance baseline

Browser state, public API, and persisted result agree; “saved” followed by lost data on refresh is blocking.

---

## E2E-011 — Copy, edit copied Item and soft delete

- **Status**: `Passed` — Item copy, independent edit, and soft-delete controls pass through the Trip page.
- **Coverage**: M2; B05–B06; copy and soft delete
- **Goal**: verify that copying creates an independent fact and deletion preserves historical relations.

### Manual steps

1. Create Dining Item “Breakfast” on Day 1.
2. Copy it to Day 2.
3. Open the Day 2 copy, rename it “Breakfast (edited copy),” and set note to “Copy edited.”
4. Return to Day 1, delete the original, and confirm.
5. Refresh and verify Day 1 and Day 2 separately.

### Detailed checks

- The copy has a new ID, the correct target Day, and initially identical fields.
- Editing the copy does not change the original.
- After original deletion, it is absent from the active timeline while the copy remains writable.
- Deletion is soft; historical Expenses or Attachments are not physically lost through cascade.
- Copy edits and original deletion survive refresh.

### Acceptance baseline

Copy, independent edit, delete, and refresh must all complete through the UI.

---

## E2E-012 — Same-day reorder across mouse, keyboard and touch

- **Status**: `Passed` — mouse, keyboard, and mobile-equivalent ordering all persist through the product UI.
- **Coverage**: M2/M3; B07, C07; ordering and route generation
- **Goal**: verify that three interaction methods submit the same atomic order fact and trigger one route invalidation.

### Preconditions

- Day 1 contains A, B, C, D in that order.
- Each Item has a stable ID; at least A/B/C have confirmed coordinates.

### Manual steps

1. On desktop, drag into B→A→D→C order.
2. Refresh and confirm the order.
3. Move D upward once with the keyboard and hear/read the accessible status announcement.
4. Open the same Day at Pixel 7 viewport and move once using touch or an equivalent control.
5. Refresh again.

### Detailed checks

- Each submission contains the complete same-Day Item ID set, without omissions, duplicates, or cross-Day IDs.
- The reorder transaction fully succeeds or fully rolls back.
- Day version grows exactly once for each successful operation.
- Each reorder produces one current-generation invalidation/rebuild fact.
- Visual order, API order, and database sort order agree.
- Keyboard and mobile paths have the same business capability as mouse input.

### Acceptance baseline

All three methods persist and survive refresh; a test of only the Timeline class cannot replace page acceptance.

---

## E2E-013 — Custom transport mode lifecycle

- **Status**: `Passed` — custom Mode management, Item selection, map presentation, and deactivation pass.
- **Coverage**: M2/M3; B09, C08; custom transport modes
- **Goal**: verify consistent custom Mode behavior from creation through Item, map, and deactivation.

### Data matrix

- code: `CABLE_SHUTTLE_CUSTOM`
- label: `Cable-car shuttle`
- color: `#123456`
- lineStyle: `dotted`
- icon: `cable-car`

### Manual steps

1. Open transport-mode management in Trip settings.
2. Create and save the custom Mode above.
3. Create a Transport Item and select that Mode.
4. Open the timeline and map to inspect route styling.
5. Refresh and reopen the Item.
6. Return to settings, deactivate the Mode, then open both the existing Item and a new-Item form.

### Detailed checks

- code is unique within the Trip and cannot override a system Mode.
- The new Mode appears immediately in the Item Mode selector.
- Item, map, details, and later print tokens use the same label/icon/color/lineStyle.
- The Mode and its references survive refresh.
- After deactivation, existing references remain readable with a warning, while new Items no longer offer it by default.

### Acceptance baseline

The accepted run used the real product settings entry point and public persistence path; a configuration-class test cannot close this case.

---

## E2E-014 — Explicit location search, candidate confirmation and persistence

- **Status**: `Passed` — explicit Location search, candidate confirmation, and persistence pass in the Item UI.
- **Coverage**: M2; C02–C04; Location search and confirmation
- **Goal**: verify that same-name candidates require explicit user confirmation and that the choice survives refresh.

### Preconditions

- For “People's Square,” the fixture Provider returns at least two candidates in different city/region contexts.
- Each candidate has valid coordinates, provider, attribution, and a signed token.

### Manual steps

1. Open Location input on an Attraction Item.
2. Enter “People's Square.”
3. Click explicit search and wait for candidates.
4. Read candidate name, city, region, and source; leave the field without selecting.
5. Return and select the Shanghai candidate.
6. Save the Item, refresh, and reopen it.

### Detailed checks

- The first candidate is never silently selected before or after search.
- Request trigger is explicit and profile matches the Trip mapProfile.
- Confirmation submits the signed candidate token instead of trusting raw client Provider data.
- The saved Location is WGS84 with correct provider, formattedAddress, attribution, and resolved status.
- Item and Location belong to the same Trip/owner.
- Refresh retains the same Location without repeated geocoding.

### Acceptance baseline

Search, candidate display, manual choice, save, and refresh all pass through the UI.

---

## E2E-015 — Map pick, Marker drag and manual coordinate persistence

- **Status**: `Passed` — map pick, Marker drag, manual coordinates, persistence, and stale-response protection pass.
- **Coverage**: M2; C05–C06; manual-coordinate precedence
- **Goal**: verify that map pick, Marker drag, and manual input each produce a stable manual fact.

### Data matrix

- Initial Location: text-only “Near the Bund,” without confirmed coordinates.
- Map pick: `121.4900, 31.2400`.
- Marker drag: `121.5000, 31.2300`.
- Final manual input: longitude `121.5100`, latitude `31.2200`.

### Manual steps

1. Open Location Picker and confirm the initial unresolved state.
2. Click the first coordinate on the map and save.
3. Drag the Marker to the second coordinate and save.
4. Open manual coordinate input, enter the final coordinate, and confirm.
5. Refresh and reopen the map.

### Automation requirements

- Hold an old geocode response before the first action and release it only after the final manual save.
- Every coordinate change uses the public API and current ETag.

### Detailed checks

- Version grows after every save and the final coordinate exactly matches manual input.
- CRS is WGS84 and coordinates are in range.
- `manuallyAdjusted=true`; the stale geocode response affects zero rows.
- After refresh, the Marker remains at the final coordinate.
- Reverse-geocoding failure does not block coordinate persistence.

### Acceptance baseline

All three user paths save independently, and a late response cannot override the final manual fact.

---

## E2E-016 — Full runtime route-to-MapLibre happy path

- **Status**: `Passed` — the former runtime DirectionsProvider → Worker → Route API → MapLibre gap is closed and verified.
- **Coverage**: M2/M3; C05, C07–C09; complete map-route path
- **Goal**: prove the complete product loop from user-confirmed Location through Worker and Route API to MapLibre.

### Preconditions and Provider matrix

- Create A, B, C with confirmed WGS84 Locations.
- A→B uses WALK and B→C uses METRO.
- The Directions fixture must return a polyline with at least three points through the production Provider contract, not just its two endpoints.
- Tile fixture supplies recognizable local tiles and fixed attribution.

### Manual steps

1. Create a Trip from the homepage.
2. Create A, B, C through Item Editor and confirm their Locations.
3. Set inbound transport modes for B and C.
4. Wait for the page to show route generation, then for generation to complete.
5. Open the global map and inspect basemap, Markers, routes, and attribution.
6. Click timeline Item B and observe map focus/highlight.
7. Click map Marker C and observe timeline scroll/highlight.
8. Click route A→B and inspect Mode, provider, quality, and endpoints.
9. Refresh and repeat steps 5–8.

### Automation requirements

- Record Directions fixture call count and request summary.
- Listen for Tile fixture requests to prove that the browser requested the basemap.
- Read `/trips/{tripId}/routes`, but never inject its response directly into the map.
- Verify that MapLibre source geometry matches Route API geometry.

### Detailed checks

- Item/Location changes create outbox events consumed by a real BullMQ Worker.
- DirectionsProvider receives correct endpoints, Mode, and mapProfile.
- RouteSegment `routeProvider`, `routeQuality`, and geometry match the Provider response.
- Geometry contains an intermediate bend, proving it is not a direct Worker `ST_MakeLine`.
- `/routes` returns one active generation and excludes old/obsolete routes from current results.
- MapLibre style has a real or fixture basemap source and Tile fixture receives a request.
- Markers, routes, legend, and attribution are visible.
- UI quality label matches database fact; approximate is never shown as actual.
- UI does not substitute default Shanghai coordinates for a missing Location.
- Timeline, Marker, and Route share one selection state.

### Acceptance baseline

The entire browser → Worker → Provider → database → API → MapLibre path must pass in one run. Failure blocks M3 route sign-off.

---

## E2E-017 — Cross-day and transport-internal route matrix

- **Status**: `Passed` — cross-Day, Transport-internal, blocker/gap, Mode, and server-quality presentation pass.
- **Coverage**: M3; C07–C09; route business matrix
- **Goal**: verify cross-Day segments, Transport internal segments, unconfirmed-Location blockers, and multiple Modes.

### Preconditions

- Day 1: A, B.
- Day 2: C, Transport D, E, and F with an unconfirmed Location.
- Transport D has both StartLocation and EndLocation.
- Modes cover WALK, FLIGHT, FERRY, TRANSIT, and one custom Mode.

### Manual steps

1. Create the Items and Locations above in order.
2. Wait for every generatable route to complete.
3. Switch between Day and global maps and inspect each Segment.
4. Reorder A/B and change one route Mode.
5. After the old route disappears, wait for the new route to generate.
6. Confirm the route-gap explanation around F.

### Detailed checks

- The last Item of Day 1 to first Item of Day 2 Segment belongs to the arrival Day.
- Transport D creates an item-transport internal segment; connectors do not draw the same endpoints twice.
- Routing does not skip over unconfirmed F to connect a more distant Location.
- Missing Mode explicitly falls back to OTHER with a user prompt.
- WALK, FLIGHT, FERRY, TRANSIT, and custom Mode are distinguishable by icon, line style, and text.
- actual, approximate, and manual labels come from RouteSegment rather than frontend hardcoding.
- Reorder or Mode change obsoletes old routes; before the new generation completes, old routes are not shown as current.
- Current generation, route details, and map agree after refresh.

### Acceptance baseline

Every Segment type, gap, and quality semantic must be correct on a real page consuming Route API.

---

## E2E-018 — Multi-image upload and gallery happy path

- **Status**: `Passed` — the owning Item and all Gallery operations are created and exercised through the UI.
- **Coverage**: M1–M3; D01–D03; secure upload and image UX
- **Goal**: verify the complete multi-image path from direct browser upload and processing through gallery management.

### Data matrix

- `day-view.jpg`: valid landscape JPEG.
- `meal.png`: valid square PNG.
- `hotel.webp`: valid portrait WebP.
- All three have distinct content and checksums.

### Manual steps

1. Open Image Workspace for an existing Item.
2. Select all three images in one upload action.
3. Observe preparation, upload progress, and safe-processing state for each image.
4. Wait until all three are ready.
5. Enter each caption and leave its field to trigger save.
6. Set the second image as cover.
7. Use move-forward/back controls to order them third, second, first.
8. Open the second image in the lightbox and close it.
9. Delete the first image and confirm deletion.
10. Refresh.

### Detailed checks

- Each image creates an independent upload session and Attachment.
- Content reaches MinIO and is processed by ClamAV/ImageMagick Worker after completion.
- pending/uploaded/processing states show no broken image; ready shows the real preview.
- width, height, and aspect ratio match processing output.
- caption, cover, sort order, and version persist correctly.
- An Item has only one cover.
- Data is unchanged before deletion confirmation and absent from gallery and refreshed result after confirmation.
- Logs contain no signed-URL query or object secret.

### Acceptance baseline

All three formats complete real storage and processing, every gallery operation survives refresh, and the owning Item is created through the UI.

---

## E2E-019 — Multi-currency expense and summary reconciliation

- **Status**: `Passed` — Item-owned expense entry, Trip-scoped rate management, daily CNY totals, and click-through details pass.
- **Coverage**: M2/M3; D04–D05; Decimal, rates, and five-dimensional summaries
- **Goal**: reconcile multi-currency Expenses, manual rates, and summaries from original facts.

### Data matrix

| Item / category | Original amount | Currency | Rate to CNY |
|---|---:|---|---:|
| Dining / DINING | 200.00 | CNY | not needed |
| Transport / TRANSPORT | 50.25 | USD | 7.2000 |
| Attraction / TICKET | 8000 | JPY | 0.0480 |
| Other / SHOPPING | 100000 | VND | 0.00030 |

### Manual steps

1. Create four Items belonging to different Days, Destinations, and Modes.
2. Enter each Expense while creating its owning Item in the daily itinerary editor.
3. Open rate management and enter manual USD, JPY, and VND to CNY rates.
4. Inspect the read-only daily CNY tree; click each Day and reconcile its details.
5. Refresh and reopen each Day detail.

### Detailed checks

- Original amounts are Decimal strings without binary floating-point error.
- A rate is positive and from/to currencies differ.
- Each converted amount uses a save-time snapshot traceable to original amount and rate.
- Original and converted totals reconcile by Day; each clicked Day shows its Item-level original amount, rate snapshot, notes, and CNY amount.
- Known actual CNY total matches manual calculation.
- Removing a rate moves the amount into unconverted and shows “known actual / provisional remainder,” never a misleading green balance.
- Amounts, rates, and summary remain consistent after refresh.

### Acceptance baseline

Four representative currencies reconcile through the daily read-only report; E2E-021 covers selection of all 15 currencies.

---

## E2E-020 — Three-format import, mapping and staging preview

- **Status**: `Passed` — all three formats, visible upload stages, Mapping, filters, counts, skip confirmation, and persisted Preview pass.
- **Coverage**: M0/M2/M3; A10, E01–E05; import staging
- **Goal**: verify xlsx/xls/csv from upload through mapping and reviewable Preview without production business side effects.

### Data matrix

- Standard Chinese `.xlsx`: Day, date, Item, time, expense, currency, Mode.
- English-alias `.xls`: Date, Target, Start, End, Cost, Currency, Transport.
- Mixed Chinese/English `.csv`: representative new, update, duplicate, error, and unresolved rows.
- At least one error row is attributable to an exact field; remaining valid rows form the main happy path.

### Manual steps

1. Select the first file in Import Workspace on a new Trip.
2. Observe upload-session creation, upload, scan, and inspection states.
3. Wait for a real ImportJob ID.
4. Inspect suggested mappings, source-column samples, and explanations.
5. Change at least one Mapping and save.
6. Open Preview and inspect raw value, normalized value, status, and error page by page.
7. Filter by status and confirm counts.
8. Select an error row, choose “Skip error,” and complete secondary confirmation.
9. Refresh and confirm Mapping and Preview restoration.
10. Repeat the main flow for the other two formats.

### Automation requirements

- Use real signed upload, MinIO, ClamAV, and inspection/import Worker.
- Before and after upload, record production Item, Location, and Expense counts through a read-only API.
- Never call importer functions directly instead of the upload path.

### Detailed checks

- Every format creates an Attachment, Inspection Job, and ImportJob.
- Database is authoritative for Job status; Redis only delivers work.
- Canonicalized Mapping has a stable hash that survives refresh.
- Missing required targets, duplicate targets, and unknown columns have explicit errors without silent overwrite.
- Preview shows raw and normalized values together.
- new/update/duplicate/error/unresolved/skipped counts sum to total rows.
- Errors identify sheet, row, field, and reason.
- Skip persists and survives refresh.
- Production Item, Location, and Expense counts remain unchanged throughout.
- UI never claims “imported into production” or another result beyond M3.

### Acceptance baseline

All formats pass real upload and staging with exact state/counts and zero production side effects.

---

## E2E-021 — Full currency Reference Data availability and normalization

- **Status**: `Passed` — Trip, Expense, rate, and Import now consume and verify the shared 15-currency Reference Data.
- **Coverage**: M1–M3; B01, B04, D04–D05, E01–E05; Reference Data consistency
- **Goal**: ensure that all designed currencies are supported and Trip, Expense, Import, and rates use the same Reference Data.

### Currency matrix

| Code | Display name | Representative aliases |
|---|---|---|
| CNY | Chinese yuan | RMB, 人民币, ¥ |
| USD | US dollar | 美元, US$ |
| EUR | Euro | 欧元, € |
| JPY | Japanese yen | 日元, 円 |
| KRW | South Korean won | 韩元, ₩ |
| PHP | Philippine peso | 菲律宾比索, ₱ |
| THB | Thai baht | 泰铢, ฿ |
| SGD | Singapore dollar | 新加坡元, S$ |
| MYR | Malaysian ringgit | 林吉特, RM |
| VND | Vietnamese dong | 越南盾, ₫ |
| IDR | Indonesian rupiah | 印尼盾, Rp |
| HKD | Hong Kong dollar | 港币, HK$ |
| TWD | New Taiwan dollar | 新台币, NT$ |
| AUD | Australian dollar | 澳元, A$ |
| GBP | Pound sterling | 英镑, £ |

### Manual steps

1. Open new Trip and expand Default currency.
2. Check all 15 codes and display names against the matrix.
3. Select each currency and create a minimum single-day Trip; automation may parameterize 15 runs.
4. Refresh and read detail/API for each Trip to confirm defaultCurrency.
5. Open a new Item in the daily itinerary and expand its Expense currency selector.
6. Check the same 15 currencies and create a minimum valid Item-owned Expense for each; automation may use separate Items or clean up each time.
7. Open rate management and check that from/to selectors use the same currency set.
8. Upload an import containing all 15 codes and the `RMB` alias, then enter Preview.
9. Confirm `RMB` normalizes to `CNY` and other codes remain unchanged.

### Automation requirements

- Expected values come from a versioned test constant or public Reference Data contract, never by deriving expected data from the current DOM.
- Compare sets across Trip, Expense, rate selectors, and Import Preview.
- Verify count, code uniqueness, missing entries, and Reference Data ordering.

### Detailed checks

- `/system/reference-data` returns exactly the 15 enabled designed currencies.
- Trip Default currency shows all 15, not only CNY/USD/JPY.
- Expense currency shows all 15, not only CNY/USD.
- Every currency creates a Trip and persists its original code.
- Every currency creates an Expense and appears in its original-currency summary.
- Rate from/to sets are identical and disallow a meaningless same-currency rate.
- `RMB` is only an input/display alias; persistence and normalized Preview use CNY.
- Input code casing is normalized and persistence uses uppercase ISO code.
- Pages do not maintain options that conflict with Reference Data.
- Adding or deactivating a system currency requires no component-code change to appear in Web.

### Acceptance baseline

Trip, Expense, Exchange Rate, and Import use the same 15-currency set; all 15 parameterized creations succeed and RMB→CNY normalization is correct.

---

## E2E-022 — Global/Day map scope and stable MapLibre sizing

- **Status**: `Passed`
- **Coverage**: M3; C08–C09; shared Trip map, Day focus, and Location coordinate adjustment
- **Goal**: prove that the real MapLibre canvas shows the full Trip by default, follows Day selection without remounting, and remains dimensionally stable in both route and coordinate-adjustment surfaces.

### Preconditions and data

- Create a two-day Trip through the browser UI.
- Create one confirmed Location-backed Item on Day 1 and another on Day 2, using different fixture coordinates.
- Keep the fixture Tile Provider enabled through the production Web tile proxy.

### Manual steps

1. Reload the Trip detail page after both Items have been saved.
2. Confirm that `Global map` is selected and both Items appear as markers.
3. Observe the route map for at least 750 ms and confirm that its height remains fixed and its canvas stays inside the map container.
4. Click Day 1 in the left itinerary and confirm that the right map fits and displays only the Day 1 marker and routes.
5. Click Day 2 and confirm that the map fits and displays only the Day 2 marker and routes.
6. Click `Global map` and confirm that both markers return.
7. Select Day 1 and edit its Item.
8. In the confirmed Location section, inspect `Adjust coordinates`.
9. Confirm that the coordinate-adjustment map has a real MapLibre canvas, fixture raster attribution, and a visible marker.
10. Observe the coordinate map for at least 750 ms and confirm that its height remains fixed without continuous growth.

### Automation requirements

- Create Trip, Items, and confirmed Locations only through visible UI operations.
- Do not use `page.evaluate()` or direct CRUD requests.
- Select persisted Items by their stable entity-backed element IDs, not by localized Item names.
- Verify marker membership through stable `data-item-id` values.
- Measure both the map container and canvas through Playwright bounding boxes.

### Detailed checks

- Initial map scope is global even though the left itinerary has Day 1 selected.
- Global scope includes both persisted confirmed points.
- Day selection updates the existing MapLibre instance and refits to every valid point for that Day.
- Returning to Global scope restores all valid Trip points.
- Route-map height remains 320 px and coordinate-map height remains 256 px across delayed measurements.
- Neither canvas exceeds its owning container height.
- Both map surfaces load the shared fixture raster configuration and visible attribution.
- Location confirmation, marker persistence, and route data remain intact after scope changes and refresh.

### Acceptance baseline

Global, Day 1, Day 2, and coordinate-adjustment maps all render real, bounded MapLibre canvases; any missing scope, stale marker, absent raster attribution, or growing container fails the case.

---

## 3. Recommended execution sets

### 3.1 Short happy path for every PR

- E2E-001: environment and capabilities;
- E2E-002: identity;
- E2E-003: standard Trip creation;
- E2E-009: complete Item creation;
- E2E-014: Location confirmation;
- E2E-016: real runtime route map;
- E2E-018: images;
- E2E-019: expenses;
- E2E-020: import staging.

### 3.2 Nightly/full M0–M3 regression

- Run E2E-001 through E2E-022.
- Parameterize Trip/Expense currency cases across all 15 currencies.
- Run map cases at desktop and mobile viewports.
- Run all three import formats.
- Preserve full traces, videos, Provider call summary, and commit-bound report.

### 3.3 M3 re-acceptance result

- E2E-009, 012, 014, 015, 016, 017, 018, 019, and 020 all passed.
- E2E-016/017 may not substitute SVG fallback, a direct database processor, or frontend-generated geometry.
- `routeProvider`, `routeQuality`, geometry, and UI labels come from the same runtime fact.
- Product Owner manually spot-checks at least E2E-003, 009, 016, 018, 019, and 020 with these steps.
- The 2026-08-09 automated browser result is recorded in the M3 Gate and Product acceptance addenda against implementation commit `c0e2e3a`.

## 4. Resolved review decisions

The accepted implementation resolves the earlier review questions as follows:

1. all 22 cases are implemented as executable browser acceptance cases;
2. every former `Partial` and `Critical gap` case is now `Passed`;
3. E2E-016/017 remain mandatory M3 route/map gates and both pass;
4. Item, Location, Trip settings/list/trash, Mode, Gallery, Expense, Import, and Reference Data entry points are available in the current product navigation;
5. CI uses deterministic fixture Directions geometry, Tile attribution, and observable requests through production runtime contracts;
6. all 15 Reference Data currencies are user-enabled across the accepted paths;
7. the accepted Full Suite uses Chromium, one worker, isolated data, trace retention, and failure screenshot/video;
8. durable CI artifact retention and any human sign-off/recording remain governed by milestone and release process documents.
