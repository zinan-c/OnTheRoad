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
