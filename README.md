# On The Road

M0, “Risk Validation and Engineering Baseline,” is complete. The repository
now contains the engineering baseline and validated technical spikes, but
business CRUD and the product UI have not started:

- [Product and technical design](./docs/DESIGN.md)
- [Development plan](./docs/DEVELOPMENT_PLAN.md)

M0 covers `A01–A04` and `A08–A12`. Passing a technical spike does not mean
that its downstream product capability has been implemented or accepted.

## M0 engineering baseline

- Node.js: `24.14.0`
- pnpm: `9.15.4`
- Install: `pnpm install --frozen-lockfile`
- Toolchain check: `pnpm run toolchain:check`
- Full quality gate: `pnpm run quality`
- Clean-checkout smoke test: `pnpm run ci:smoke`

`pnpm run quality` uses Turbo to run real ESLint, TypeScript, Vitest, and build
tasks across every workspace. The PDF spike also requires a Chromium version
compatible with `@playwright/test`; CI installs it in the relevant job. To use
an existing local browser, set `OTR_A11_CHROMIUM_PATH`. Never commit a
developer-machine absolute path to source code.

### Map profiles

`MAP_PROFILE=fixture` is the key-free development default. The API constructs
the selected online profile during startup and fails closed when its required
credentials are absent:

- `cn_primary` uses AMAP (`AMAP_API_KEY`) and converts AMAP GCJ-02 coordinates
  to the WGS84 domain model.
- `international_primary` uses HERE (`OTR_HERE_API_KEY`).
- `hybrid` requires both keys. It routes searches with `CN`/`CHN` country
  context and coordinates inside mainland-China bounds to AMAP; all other
  requests use HERE. Provider failures are returned as-is and never trigger
  silent fallback or rewrite the Trip profile.

Keys remain server-side. CI and normal local tests use in-process provider
fixtures and do not call public map services.

### Requirements delivery index

| # | Deliverable | Location |
|---:|---|---|
| 1 | Requirements interpretation and necessary assumptions | DESIGN §1 |
| 2 | Questions requiring product confirmation | DESIGN §2 |
| 3 | Recommended architecture | DESIGN §5 |
| 4 | Technology choices and trade-offs | DESIGN §6 |
| 5 | Mermaid architecture diagram | DESIGN §7 |
| 6 | Synchronous flows | DESIGN §8 |
| 7 | Asynchronous flows | DESIGN §9 |
| 8 | Job state machine | DESIGN §10 |
| 9 | Detailed REST API design | DESIGN §11 |
| 10 | Data model and SQL DDL | DESIGN §12 |
| 11 | Queues, retries, idempotency, and consistency | DESIGN §13 |
| 12 | Security design | DESIGN §14 |
| 13 | Temporary storage and automatic cleanup | DESIGN §15 |
| 14 | Deployment and scaling | DESIGN §16 |
| 15 | Observability | DESIGN §17 |
| 16 | MVP scope | DEVELOPMENT_PLAN §1 |
| 17 | Phase-two extensions | DEVELOPMENT_PLAN §2 |
| 18 | Recommended project structure | DEVELOPMENT_PLAN §3 |
| 19 | Key module pseudocode | DEVELOPMENT_PLAN §7 |
| 20 | Test strategy and acceptance criteria | DEVELOPMENT_PLAN §9–11 |
