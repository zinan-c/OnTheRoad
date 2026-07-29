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
