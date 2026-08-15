# Observability baseline

Task A07 establishes an application-owned telemetry boundary. It does not
configure the shared collector or define production dashboards and SLOs.

## Correlation

Inbound HTTP adapters call `acceptRequestContext`. A valid W3C `traceparent` is
continued with a new span ID; an absent or invalid parent starts a new sampled
trace. `x-request-id` is preserved when present and generated otherwise.

Outbox payloads carry `createOutboxTelemetryEnvelope(...).telemetry` alongside
the versioned domain payload. A Worker calls `restoreWorkerContext` with its
durable Job ID. The trace and request IDs remain stable while the API and Worker
each get a new span ID. Business payloads should continue to contain IDs and
versions only.

## Logging and redaction

`createTelemetry` emits structured entries. Sinks may serialize them with
`JsonLineTelemetrySink`; application code must not build free-form log lines
containing request bodies.

The common redactor removes address, contact, phone, credential, authorization,
provider key, token, signature, signed URL, and Cookie fields recursively. It
also masks bearer values, phone-like strings, and signed query parameters found
in otherwise safe text. New sensitive fields must be covered by
`redaction.spec.ts` before being logged.

## Metrics

Metric labels are allowlisted per metric. The baseline includes bounded HTTP
labels (`method`, route template and status code) and queue labels (`queue` and
`outcome`). Raw request, trace, Job, Trip, User, Location or other entity IDs
must never be labels. Rejected labels create a local
`metrics.label_dropped` diagnostic.

The four application partitions and their resource names are recorded in
`infra/monitoring/telemetry-partitions.json`. Routes must be templates such as
`/trips/:tripId`, never concrete paths.

## Collector failure

Telemetry sinks are best effort. A synchronous sink failure is caught and an
asynchronous rejection is observed; both produce a local
`telemetry.sink_failure` diagnostic without changing the business result. The
default diagnostic is a small JSON line on standard error. Deployments may
replace it with a bounded local fallback, but must not recursively send that
diagnostic through the failed sink.

The collector-down behavior is executable in
`tests/observability/sink-failure.e2e.spec.ts`.

## M3 runtime coverage

The production API adapter now creates a request context for every request,
returns `traceparent` and `x-request-id`, and emits the following bounded
telemetry using the Fastify route template rather than a concrete URL:

- `http.server.requests{method,route,status_code}`;
- `http.server.duration{method,route,status_code}`;
- `http.request.completed` spans;
- sanitized `http.request.failed` logs containing only route template, method,
  and stable error code.

The production Worker emits `queue.jobs` and `queue.duration` with only the
bounded `queue` and `outcome` labels for import inspection, import staging, and
media processing. It also emits a completion span and a sanitized failure log.
Job, Trip, owner, Attachment, source-row, address, file content, credentials,
signed URLs, and concrete request paths are not metric labels or log payloads.

`apps/api/test/runtime/public-route-parity.e2e.spec.ts` proves an M3 route emits
template-based metrics, a span, and correlation headers without entity IDs or
session credentials. `apps/worker/test/runtime/telemetry.spec.ts` proves the
Worker's bounded queue telemetry. The existing redaction and collector-failure
suites remain authoritative for recursive PII/Secret removal and fail-open
telemetry delivery.

The database remains authoritative for route generation/status, Attachment
processing state, Expense facts, and ImportJob/ImportRow state. Telemetry is
diagnostic and never substitutes for those persisted facts.

## Online map telemetry

The post-M4 online map runtime adds bounded provider metrics and spans for
`dev`, `qa`, and `prod`:

- `geocoding.requests` / `geocoding.duration`: `provider`, `operation`,
  `status`, `cache`, `outcome`;
- `map.tiles`: `source`, `status`, `outcome`;
- `directions.requests` / `directions.duration`: `provider`, `mode`, `status`,
  `quality`, `outcome`;
- `map.rate_limited`: `provider`, `operation`, `retry_after_bucket`;
- `map.endpoint.health`: `capability`, `environment`, `status`.

Do not use raw query, address, coordinates, tile URL query parameters, Trip
ID, Location ID or request body as metric labels. Logs may retain only a
normalized query hash, provider, operation, error code, latency and retry
metadata. Public Nominatim User-Agent/contact configuration is observable as
deployment metadata, never as a secret.

Alerts must cover Nominatim 429/5xx/timeout, cache-hit collapse, tile source
failure, Directions backlog/failure and stale endpoint health. CI fixture runs
must be labeled separately and must not be counted as online provider health.
