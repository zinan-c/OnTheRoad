import {
  createTelemetry,
  JsonLineTelemetrySink,
  type TelemetrySink,
} from "@on-the-road/observability";

export const telemetryPartition = {
  serviceName: "worker",
  metricPrefix: "otr_worker",
  resourceAttributes: {
    "service.name": "on-the-road-worker",
    "service.namespace": "on-the-road",
  },
} as const;

export function createWorkerTelemetry(sinks: readonly TelemetrySink[] = [
  new JsonLineTelemetrySink((line) => console.log(line), "worker-stdout"),
]) {
  return createTelemetry({ serviceName: "worker", sinks });
}

export const workerTelemetry = createWorkerTelemetry();
export type WorkerTelemetry = ReturnType<typeof createWorkerTelemetry>;

export function recordWorkerPipeline(
  telemetry: WorkerTelemetry,
  input: {
    readonly queue: string;
    readonly outcome: "succeeded" | "failed";
    readonly durationMs: number;
    readonly errorCode?: string;
  },
) {
  if (input.errorCode) {
    telemetry.log("error", "worker.pipeline.failed", {
      queue: input.queue,
      code: input.errorCode,
    });
  }
  const labels = { queue: input.queue, outcome: input.outcome };
  telemetry.metric("queue.jobs", 1, labels);
  telemetry.metric("queue.duration", input.durationMs, labels);
  telemetry.span("worker.pipeline.completed", { attributes: labels });
}
