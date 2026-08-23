# Configuration

All four processes use `packages/config/src/env.ts`. The loader validates the
complete environment before a server starts listening and returns a
role-specific projection: browser-facing Web configuration never contains
database, object-storage or session secrets.

## Local setup

Copy `.env.example` to an ignored local environment file and replace values
only when required. The checked-in example stays fixture-backed so CI and
offline tests never access public map services; local `.env` may override it to
the online AMap profile:

```sh
cp .env.example .env
pnpm run toolchain:check
```

For local China online-map development, the target profile is for example:

```dotenv
MAP_PROFILE=cn_primary
AMAP_API_KEY=server-web-service-key
AMAP_JS_API_KEY=browser-js-key
AMAP_JS_SECURITY_CODE=browser-security-code
OTR_MAP_DEFAULT_LAYER=amap-street
```

`AMAP_API_KEY` is server-only. The browser receives only
`AMAP_JS_API_KEY`, `AMAP_JS_SECURITY_CODE`, the selected layer, provider and
attribution from same-origin `/api/map/config`. Never put the Web Service key
in a `NEXT_PUBLIC_*` variable or browser markup.

Runtime configuration has three deployment environments and one explicit
offline/fixture mode:

- local `dev`: native or Compose Postgres, Redis, MinIO, ClamAV and local Node
  processes; it does not start a local map database. Use `cn_primary` for the
  AMap online runtime or `fixture` for deterministic work.
- `dev`: native/local Postgres, Redis, MinIO, ClamAV and local Node processes;
  Docker is not checked. The selected profile is explicit.
- `qa`: native, container or remote can be selected independently per service.
  Copy `config/profiles/qa.env.example` to `config/profiles/qa.env`, then run
  commands with `bash scripts/run-profile.sh qa -- ...`. The map runtime is
  selected explicitly for the run.
- `prod`: production configuration. `cn_primary` is the production-shaped
  AMap runtime;
  release validation is a workflow against `prod`, not a fourth runtime
  environment.

Examples:

```sh
pnpm run test:integration
pnpm run profile:qa -- pnpm exec vitest run tests/milestones/m3/real-environment.e2e.spec.ts
pnpm run profile:release -- pnpm run test:cases:required
```

In QA, `OTR_QA_<SERVICE>_MODE` accepts `native`, `container` or `remote` for
  `POSTGRES`, `REDIS`, `MINIO`, `CLAMAV`, `API`, `WEB`, `WORKER` and
  `PDF_WORKER`. Selecting
`container` records the intended topology but does not start Docker implicitly;
the selected endpoints must still be supplied and reachable. This keeps QA
flexible without moving the A02 Docker gate into ordinary development runs.

The capability response is derived from the validated provider configuration:

- `cn_primary`: AMap Web Service search/reverse, AMap JS 2.0 layers, AMap
  Directions and AMap Static Map are enabled only when their credentials and
  validated URLs are present;
- `fixture`: fixture search/reverse/Directions/static maps and the local
  deterministic raster are enabled; no network request is made;
- autocomplete is always disabled and batch geocoding is not a public
  capability;
- `international_primary` and `hybrid` retain their explicit Nominatim path
  for non-CN deployments and never alter `cn_primary`.

The active `cn_primary` geocoder configuration is official AMap:

- `AMAP_API_KEY` for server-side Search/Reverse, Directions and Static Map;
- `AMAP_JS_API_KEY` and `AMAP_JS_SECURITY_CODE` for the official Web JS 2.0
  runtime, exposed only through `/api/map/config`;
- `OTR_AMAP_TIMEOUT_MS`, `OTR_AMAP_RATE_LIMIT_RPS` and
  `OTR_AMAP_CACHE_TTL_SECONDS` for Search/Reverse;
- `OTR_DIRECTIONS_BASE_URL`, `OTR_DIRECTIONS_TIMEOUT_MS`,
  `OTR_DIRECTIONS_ATTRIBUTION` and `OTR_AMAP_DRIVING_STRATEGY` (AMap v5
  accepts `0` through `20`; do not use the `32+` values from the separate
  Route Planning 2.0 API);
- `OTR_STATIC_MAP_BASE_URL` and `OTR_STATIC_MAP_ATTRIBUTION`;
- `OTR_MAP_DEFAULT_LAYER` (`amap-street`, `amap-satellite` or
  `amap-satellite-labels`).

For `cn_primary`, Web map requests go only to the official AMap JS SDK and
server requests go only to the configured official AMap Web Service endpoints.
No public OSM tile endpoint, undocumented `webrd*.is.autonavi.com` host,
Geoapify or Nominatim fallback is permitted for this profile. A provider error
is surfaced as an error/degraded state; it does not change the profile.

## Validation and redaction

`loadProcessConfig(role, environment)` returns field-level errors with code
`CONFIG_VALIDATION_FAILED`. Errors name fields but never echo supplied values.
`redactSecrets` also removes values whose keys contain `key`, `secret`,
`password`, `token`, or `credential` from structured diagnostic payloads and
free-form nested messages.

Production startup rejects secrets containing development patterns such as
`local`, `change-me`, or `dev-only`. The `hybrid` map profile requires
`AMAP_API_KEY` and valid explicit Nominatim configuration for its non-CN leg;
`cn_primary` additionally requires both browser AMap credentials. A single
Provider failure never silently changes the configured profile or changes
online results to fixture results.

AMap keys and security values are never included in readiness or capability
diagnostics. Logs contain provider, mode, status, duration and safe field names,
not query text, coordinates, keys or full upstream URLs with credentials. The
application must not implement autocomplete, and every AMap request has a
separate timeout/rate/cache policy.

## Required server variables

Profile files and deployment injection use the `OTR_ENV_*` vocabulary. The
profile launcher validates it and exports the application-facing aliases before
starting a process; application code does not independently merge profile
files. API, Worker and PDF Worker require:

- `OTR_ENV_DATABASE_URL`, `OTR_ENV_REDIS_URL`;
- `OTR_ENV_OBJECT_STORAGE_ENDPOINT`, region, access key, secret key and bucket;
- `OTR_ENV_CLAMAV_HOST` and optional `OTR_ENV_CLAMAV_PORT`;
- `OTR_ENV_SESSION_SECRET` (exported to the process as `SESSION_SECRET`).

Web consumes only `APP_ORIGIN`, `API_BASE_URL`, ports and map capabilities;
it receives the public AMap JS key/security code and layer catalog, never
`AMAP_API_KEY`, database credentials or storage/session secrets.
For `pnpm run dev`, the launcher defaults to the Native dependency track. Pass
`pnpm run dev -- -native` or `pnpm run dev -- -compose` to select the track;
the accepted `-componse` spelling is retained as an alias. The launcher
prefers the project-specific ports `18100` (Web) and `18101` (API). If either
is occupied, it selects the next free port pair and prints the exact Web and
API live/ready/base URLs after the application becomes ready.

`OTR_COMMIT_SHA`, `GITHUB_SHA`, and `OTR_REQUIRED_CASE_REPORT` are Gate/evidence
inputs, not application configuration. The required-case runner records the
full commit and clean-worktree state; the verifier rejects a report that does
not match the current closure candidate.
