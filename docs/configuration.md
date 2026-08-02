# Configuration

All four processes use `packages/config/src/env.ts`. The loader validates the
complete environment before a server starts listening and returns a
role-specific projection: browser-facing Web configuration never contains
database, object-storage or session secrets.

## Local setup

Copy `.env.example` to an ignored local environment file and replace values
only when required. The checked-in example deliberately uses development-only
credentials and the offline `fixture` map profile:

```sh
cp .env.example .env
pnpm run toolchain:check
```

Runtime configuration has three explicit profiles:

- `dev`: native/local Postgres, Redis, MinIO, ClamAV and local Node processes;
  Docker is not checked.
- `qa`: native, container or remote can be selected independently per service.
  Copy `config/profiles/qa.env.example` to `config/profiles/qa.env`, then run
  commands with `bash scripts/run-profile.sh qa -- ...`.
- `release`: production-shaped configuration. Docker/Compose and real Staging
  IdP checks are release gates, not development checks.

Examples:

```sh
pnpm run test:integration
pnpm run profile:qa -- pnpm exec vitest run tests/milestones/m3/real-environment.e2e.spec.ts
pnpm run profile:release -- pnpm run test:cases:required
```

In QA, `OTR_QA_<SERVICE>_MODE` accepts `native`, `container` or `remote` for
`POSTGRES`, `REDIS`, `MINIO`, `CLAMAV`, `API`, `WEB` and `WORKER`. Selecting
`container` records the intended topology but does not start Docker implicitly;
the selected endpoints must still be supplied and reachable. This keeps QA
flexible without moving the A02 Docker gate into ordinary development runs.

The default capability response is:

- offline map and local fixtures: enabled;
- explicit online search: disabled;
- autocomplete: disabled;
- batch geocoding: disabled.

Provider keys remain empty in no-key development mode. To enable the
`international_primary` profile, configure `OTR_HERE_API_KEY` at runtime;
the key is returned only to server process configurations. HERE Geocoding,
Discover and Reverse Geocoding endpoints are separately configurable and
default to the official API v7 hosts.

## Validation and redaction

`loadProcessConfig(role, environment)` returns field-level errors with code
`CONFIG_VALIDATION_FAILED`. Errors name fields but never echo supplied values.
`redactSecrets` also removes values whose keys contain `key`, `secret`,
`password`, `token`, or `credential` from structured diagnostic payloads and
free-form nested messages.

Production startup rejects secrets containing development patterns such as
`local`, `change-me`, or `dev-only`. The `hybrid` map profile requires both
`AMAP_API_KEY` and `OTR_HERE_API_KEY`; a single Provider
failure never silently changes the configured profile.

## Required server variables

API, Worker and PDF Worker require:

- `DATABASE_URL`, `REDIS_URL`;
- `OBJECT_STORAGE_ENDPOINT`, access key, secret key and bucket;
- `CLAMAV_HOST` and optional `CLAMAV_PORT`;
- `SESSION_SECRET`.

Web consumes only `APP_ORIGIN`, `API_BASE_URL`, ports and map capabilities.
