import { describe, expect, test } from "vitest";

import {
  InMemoryTelemetrySink,
  MetricsRegistry,
  createTelemetry,
} from "../src/index.js";

describe("TC-A07-02 PII and high-cardinality guard", () => {
  test("removes address, contact, provider key and signed URL material", () => {
    const sink = new InMemoryTelemetrySink();
    const telemetry = createTelemetry({ serviceName: "api", sinks: [sink] });

    telemetry.log("info", "location resolved", {
      address: "上海市黄浦区测试路 88 号",
      contactPhone: "+86 138-0013-8000",
      providerApiKey: "here-super-secret",
      imageUrl:
        "https://assets.example.test/image.jpg?X-Amz-Signature=abc123&token=private",
      nested: {
        authorization: "Bearer private-access-token",
      },
      status: "confirmed",
    });
    telemetry.span("geocode.lookup", {
      attributes: {
        "location.address": "上海市黄浦区测试路 88 号",
        "contact.phone": "+86 138-0013-8000",
        "provider.api_key": "here-super-secret",
        "http.url":
          "https://assets.example.test/image.jpg?X-Amz-Signature=abc123",
        "location.status": "confirmed",
      },
    });

    const output = JSON.stringify(sink.entries);
    expect(output).not.toContain("上海市黄浦区测试路 88 号");
    expect(output).not.toContain("138-0013-8000");
    expect(output).not.toContain("here-super-secret");
    expect(output).not.toContain("abc123");
    expect(output).not.toContain("private-access-token");
    expect(output).toContain("[REDACTED]");
    expect(output).toContain("confirmed");
  });

  test("drops identifiers and unapproved keys from metric labels", () => {
    const diagnostics: string[] = [];
    const metrics = new MetricsRegistry({
      allowedLabels: {
        "http.server.duration": [
          "method",
          "route",
          "status_code",
          "tripId",
        ],
        "queue.jobs": ["queue", "outcome"],
      },
      diagnose: (diagnostic) => diagnostics.push(diagnostic.code),
    });

    metrics.record("http.server.duration", 12, {
      method: "POST",
      route: "/trips/:tripId",
      status_code: "201",
      tripId: "trip-123",
      requestId: "request-123",
    });
    metrics.record("queue.jobs", 1, {
      queue: "route-rebuild",
      outcome: "completed",
      job_id: "job-123",
    });

    expect(metrics.snapshot()).toEqual([
      {
        name: "http.server.duration",
        value: 12,
        labels: {
          method: "POST",
          route: "/trips/:tripId",
          status_code: "201",
        },
      },
      {
        name: "queue.jobs",
        value: 1,
        labels: { queue: "route-rebuild", outcome: "completed" },
      },
    ]);
    expect(diagnostics).toEqual([
      "metrics.label_dropped",
      "metrics.label_dropped",
      "metrics.label_dropped",
    ]);
  });
});
