export interface TelemetryContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: "00" | "01";
  readonly requestId: string;
  readonly jobId?: string;
}

export interface TraceHeaders {
  readonly traceparent?: string;
  readonly requestId?: string;
  readonly jobId?: string;
  readonly "x-request-id"?: string;
  readonly "x-job-id"?: string;
}

export interface OutboxTelemetryEnvelope<TPayload> {
  readonly payload: TPayload;
  readonly telemetry: TelemetryContext;
}

const TRACEPARENT =
  /^00-([0-9a-f]{32})-([0-9a-f]{16})-(00|01)$/iu;

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function nonZeroRandomHex(byteLength: number): string {
  let value = randomHex(byteLength);
  while (/^0+$/u.test(value)) value = randomHex(byteLength);
  return value;
}

function nextSpanId(): string {
  return nonZeroRandomHex(8);
}

function parseTraceparent(
  traceparent: string | undefined,
): Pick<TelemetryContext, "traceId" | "traceFlags"> | undefined {
  const match = traceparent?.match(TRACEPARENT);
  if (!match || /^0+$/u.test(match[1] ?? "") || /^0+$/u.test(match[2] ?? "")) {
    return undefined;
  }
  return {
    traceId: (match[1] ?? "").toLowerCase(),
    traceFlags: (match[3] ?? "00") as "00" | "01",
  };
}

function continueContext(
  parent: Pick<TelemetryContext, "traceId" | "traceFlags" | "requestId">,
  jobId?: string,
): TelemetryContext {
  return {
    traceId: parent.traceId,
    spanId: nextSpanId(),
    traceFlags: parent.traceFlags,
    requestId: parent.requestId,
    ...(jobId ? { jobId } : {}),
  };
}

export function acceptRequestContext(headers: TraceHeaders): TelemetryContext {
  const upstream = parseTraceparent(headers.traceparent);
  const requestId =
    headers.requestId ?? headers["x-request-id"] ?? nonZeroRandomHex(16);
  const jobId = headers.jobId ?? headers["x-job-id"];

  if (upstream) return continueContext({ ...upstream, requestId }, jobId);
  return {
    traceId: nonZeroRandomHex(16),
    spanId: nextSpanId(),
    traceFlags: "01",
    requestId,
    ...(jobId ? { jobId } : {}),
  };
}

export function injectTraceHeaders(
  context: TelemetryContext,
): Record<string, string> {
  return {
    traceparent: `00-${context.traceId}-${context.spanId}-${context.traceFlags}`,
    "x-request-id": context.requestId,
    ...(context.jobId ? { "x-job-id": context.jobId } : {}),
  };
}

export function createOutboxTelemetryEnvelope<TPayload>(
  context: TelemetryContext,
  payload: TPayload,
): OutboxTelemetryEnvelope<TPayload> {
  return {
    payload,
    telemetry: context,
  };
}

export function restoreWorkerContext<TPayload>(
  envelope: OutboxTelemetryEnvelope<TPayload>,
  jobId: string,
): TelemetryContext {
  return continueContext(envelope.telemetry, jobId);
}
