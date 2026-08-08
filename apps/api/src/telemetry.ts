import {
  createTelemetry,
  JsonLineTelemetrySink,
  type TelemetrySink,
} from "@on-the-road/observability";

export const telemetryPartition = {
  serviceName: "api",
  metricPrefix: "otr_api",
  resourceAttributes: {
    "service.name": "on-the-road-api",
    "service.namespace": "on-the-road",
  },
} as const;

export function createApiTelemetry(sinks: readonly TelemetrySink[] = [
  new JsonLineTelemetrySink((line) => console.log(line), "api-stdout"),
]) {
  return createTelemetry({ serviceName: "api", sinks });
}

export const apiTelemetry = createApiTelemetry();
export type ApiTelemetry = ReturnType<typeof createApiTelemetry>;
