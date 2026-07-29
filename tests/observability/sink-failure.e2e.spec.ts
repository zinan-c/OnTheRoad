import { describe, expect, test } from "vitest";

import { telemetryPartition as apiPartition } from "../../apps/api/src/telemetry.js";
import { telemetryPartition as pdfWorkerPartition } from "../../apps/pdf-worker/src/telemetry.js";
import { telemetryPartition as webPartition } from "../../apps/web/src/telemetry.js";
import { telemetryPartition as workerPartition } from "../../apps/worker/src/telemetry.js";
import {
  acceptRequestContext,
  createTelemetry,
  type TelemetryEntry,
  type TelemetrySink,
} from "../../packages/observability/src/index.js";

describe("TC-A07-03 telemetry degradation", () => {
  test("does not fail business work when the collector is unavailable", () => {
    const diagnostics: string[] = [];
    const unavailableCollector: TelemetrySink = {
      name: "unavailable-collector",
      emit(_entry: TelemetryEntry): void {
        throw new Error("connect ECONNREFUSED 127.0.0.1:4318");
      },
    };
    const telemetry = createTelemetry({
      serviceName: "api",
      sinks: [unavailableCollector],
      diagnose: (diagnostic) => {
        diagnostics.push(
          `${diagnostic.code}:${diagnostic.sinkName}:${diagnostic.message}`,
        );
      },
    });
    const context = acceptRequestContext({
      requestId: "request-business-1",
    });
    let committedTrips = 0;

    expect(() => {
      committedTrips += 1;
      telemetry.log("info", "trip.created", { tripId: "trip-1" }, context);
      telemetry.span("outbox.persisted", {
        context,
        attributes: { eventType: "trip.created" },
      });
      telemetry.metric(
        "http.server.requests",
        1,
        { method: "POST", route: "/trips", status_code: "201" },
        context,
      );
    }).not.toThrow();

    expect(committedTrips).toBe(1);
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "telemetry.sink_failure:unavailable-collector:connect ECONNREFUSED",
        ),
      ]),
    );
  });

  test("keeps telemetry resource names partitioned by application", () => {
    const partitions = [
      webPartition,
      apiPartition,
      workerPartition,
      pdfWorkerPartition,
    ];

    expect(partitions.map(({ serviceName }) => serviceName)).toEqual([
      "web",
      "api",
      "worker",
      "pdf-worker",
    ]);
    expect(new Set(partitions.map(({ metricPrefix }) => metricPrefix)).size).toBe(
      4,
    );
    expect(
      partitions.every(
        ({ resourceAttributes }) =>
          resourceAttributes["service.namespace"] === "on-the-road",
      ),
    ).toBe(true);
  });
});
