# Configuration

All four processes use `packages/config/src/env.ts`. The loader validates the
complete environment before a server starts listening and returns a
role-specific projection: browser-facing Web configuration never contains
database, object-storage or session secrets.

## Local setup

Copy `.env.example` to an ignored local environment file and replace values
only when required. The checked-in example stays fixture-backed so CI and
offline tests never access public map services; local `.env` should override it
to an online Nominatim profile:

```sh
cp .env.example .env
pnpm run toolchain:check
```

For local online-map development, the target profile is for example:

```dotenv
MAP_PROFILE=international_primary
OTR_NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org
OTR_NOMINATIM_USER_AGENT=on-the-road-dev/1.0
OTR_NOMINATIM_CONTACT=you@example.com
```

Use a real contact value for an actual run. Configure the online tile and
Directions endpoints as well when exercising the complete map/runtime path.

Runtime configuration has three deployment environments and one explicit
offline/fixture mode:

- local `dev`: native or Compose Postgres, Redis, MinIO, ClamAV and local Node
  processes; it does not start a local Nominatim database and uses the online
  map runtime by default.
- `dev`: native/local Postgres, Redis, MinIO, ClamAV and local Node processes;
  Docker is not checked. The map runtime is online by default.
- `qa`: native, container or remote can be selected independently per service.
  Copy `config/profiles/qa.env.example` to `config/profiles/qa.env`, then run
  commands with `bash scripts/run-profile.sh qa -- ...`. The map runtime is
  online by default.
- `prod`: production configuration. The map runtime is online by default;
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

The default capability response for local `dev`, `dev`, `qa`, and `prod` is:

- online geocoding and reverse geocoding: enabled when the endpoint readiness
  check passes;
- online interactive tiles: enabled when the configured tile URL and
  attribution are valid;
- online Directions: enabled only when its independent endpoint is configured
  and the real-provider gate has passed;
- autocomplete: disabled for Nominatim;
- public Nominatim batch geocoding: disabled;
- fixture geocoding, Directions, tiles and static-map assets: enabled only for
  the explicit `fixture`/offline profile and CI.

The active geocoder configuration is public online Nominatim, not HERE:

- `OTR_NOMINATIM_BASE_URL` (default target:
  `https://nominatim.openstreetmap.org`);
- `OTR_NOMINATIM_USER_AGENT` and `OTR_NOMINATIM_CONTACT`;
- `OTR_NOMINATIM_TIMEOUT_MS`, `OTR_NOMINATIM_RATE_LIMIT_RPS` and
  `OTR_NOMINATIM_CACHE_TTL_SECONDS`;
- `OTR_MAP_TILE_URL` and `OTR_MAP_TILE_ATTRIBUTION`;
- `OTR_DIRECTIONS_BASE_URL` and `OTR_DIRECTIONS_ATTRIBUTION`.

All online map requests go through the API/Provider boundary so the product
can enforce the public Nominatim policy, cache repeated queries, and keep a
configuration-only endpoint switch. Nominatim does not provide tiles or
Directions; those capabilities are independently configured.

## Validation and redaction

`loadProcessConfig(role, environment)` returns field-level errors with code
`CONFIG_VALIDATION_FAILED`. Errors name fields but never echo supplied values.
`redactSecrets` also removes values whose keys contain `key`, `secret`,
`password`, `token`, or `credential` from structured diagnostic payloads and
free-form nested messages.

Production startup rejects secrets containing development patterns such as
`local`, `change-me`, or `dev-only`. The `hybrid` map profile requires
`AMAP_API_KEY` and a valid online Nominatim/tile/Directions configuration; it
does not require a HERE key. A single Provider failure never silently changes
the configured profile or changes online results to fixture results.

The public Nominatim endpoint must receive a stable identifying User-Agent and
contact information. The application must not send personal or confidential
address data, must not implement autocomplete, and must keep the aggregate
request rate within the current public-service policy.

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
it receives tile URL/attribution and provider capability information, never
database credentials or Provider secrets.
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
