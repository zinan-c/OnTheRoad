import { describe, expect, test } from "vitest";

import {
  acceptRequestContext,
  createOutboxTelemetryEnvelope,
  injectTraceHeaders,
  restoreWorkerContext,
} from "../src/index.js";

describe("TC-A07-01 trace propagation", () => {
  test("correlates a Web request with API, outbox and Worker telemetry", () => {
    const web = acceptRequestContext({
      requestId: "request-web-1",
      traceparent:
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    });
    const api = acceptRequestContext(injectTraceHeaders(web));
    const envelope = createOutboxTelemetryEnvelope(api, {
      eventId: "event-1",
      schemaVersion: 1,
    });
    const worker = restoreWorkerContext(envelope, "job-1");

    expect(api.traceId).toBe(web.traceId);
    expect(envelope.telemetry.traceId).toBe(web.traceId);
    expect(worker.traceId).toBe(web.traceId);
    expect(worker.requestId).toBe("request-web-1");
    expect(worker.jobId).toBe("job-1");

    expect(new Set([web.spanId, api.spanId, worker.spanId]).size).toBe(3);
    expect(injectTraceHeaders(worker)).toEqual({
      "traceparent": expect.stringMatching(
        /^00-4bf92f3577b34da6a3ce929d0e0e4736-[a-f0-9]{16}-01$/,
      ),
      "x-request-id": "request-web-1",
      "x-job-id": "job-1",
    });
  });

  test("starts a valid trace when no upstream trace exists", () => {
    const context = acceptRequestContext({ requestId: "request-local-1" });

    expect(context.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(context.spanId).toMatch(/^[a-f0-9]{16}$/);
    expect(context.requestId).toBe("request-local-1");
  });
});
