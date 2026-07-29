import type { TelemetryContext } from "./context.js";
import {
  MetricsRegistry,
  type MetricPoint,
  type TelemetryDiagnostic,
} from "./metrics.js";
import { redactTelemetryData } from "./redaction.js";

export type ServiceName = "web" | "api" | "worker" | "pdf-worker";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface TelemetryEntry {
  readonly kind: "log" | "span" | "metric";
  readonly serviceName: ServiceName;
  readonly timestamp: string;
  readonly name: string;
  readonly level?: LogLevel;
  readonly context?: TelemetryContext;
  readonly data?: unknown;
  readonly metric?: MetricPoint;
}

export interface TelemetrySink {
  readonly name: string;
  emit(entry: TelemetryEntry): void | Promise<void>;
}

export interface TelemetryOptions {
  readonly serviceName: ServiceName;
  readonly sinks?: readonly TelemetrySink[];
  readonly diagnose?: (diagnostic: TelemetryDiagnostic) => void;
  readonly allowedMetricLabels?: Readonly<Record<string, readonly string[]>>;
  readonly now?: () => Date;
}

const BASE_METRIC_LABELS: Readonly<Record<string, readonly string[]>> = {
  "http.server.duration": ["method", "route", "status_code"],
  "http.server.requests": ["method", "route", "status_code"],
  "queue.jobs": ["queue", "outcome"],
  "queue.duration": ["queue", "outcome"],
};

export class InMemoryTelemetrySink implements TelemetrySink {
  readonly name = "memory";
  readonly entries: TelemetryEntry[] = [];

  emit(entry: TelemetryEntry): void {
    this.entries.push(structuredClone(entry));
  }
}

export class JsonLineTelemetrySink implements TelemetrySink {
  readonly name: string;
  readonly #write: (line: string) => void;

  constructor(
    write: (line: string) => void,
    name = "json-line",
  ) {
    this.name = name;
    this.#write = write;
  }

  emit(entry: TelemetryEntry): void {
    this.#write(JSON.stringify(entry));
  }
}

function defaultDiagnostic(diagnostic: TelemetryDiagnostic): void {
  console.error(
    JSON.stringify({
      level: "error",
      timestamp: new Date().toISOString(),
      ...diagnostic,
    }),
  );
}

export function createTelemetry(options: TelemetryOptions) {
  const sinks = options.sinks ?? [];
  const diagnose = options.diagnose ?? defaultDiagnostic;
  const now = options.now ?? (() => new Date());
  const metrics = new MetricsRegistry({
    allowedLabels: {
      ...BASE_METRIC_LABELS,
      ...options.allowedMetricLabels,
    },
    diagnose,
  });

  function reportSinkFailure(sink: TelemetrySink, error: unknown): void {
    diagnose({
      code: "telemetry.sink_failure",
      message: error instanceof Error ? error.message : "Unknown sink failure",
      serviceName: options.serviceName,
      sinkName: sink.name,
    });
  }

  function emit(entry: TelemetryEntry): void {
    for (const sink of sinks) {
      try {
        const result = sink.emit(entry);
        if (result instanceof Promise) {
          void result.catch((error: unknown) => reportSinkFailure(sink, error));
        }
      } catch (error) {
        reportSinkFailure(sink, error);
      }
    }
  }

  return {
    metrics,
    log(
      level: LogLevel,
      message: string,
      data?: unknown,
      context?: TelemetryContext,
    ): void {
      emit({
        kind: "log",
        serviceName: options.serviceName,
        timestamp: now().toISOString(),
        name: message,
        level,
        ...(context ? { context } : {}),
        ...(data === undefined
          ? {}
          : { data: redactTelemetryData(data) }),
      });
    },
    span(
      name: string,
      details: {
        readonly context?: TelemetryContext;
        readonly attributes?: Readonly<Record<string, unknown>>;
      } = {},
    ): void {
      emit({
        kind: "span",
        serviceName: options.serviceName,
        timestamp: now().toISOString(),
        name,
        ...(details.context ? { context: details.context } : {}),
        ...(details.attributes
          ? { data: redactTelemetryData(details.attributes) }
          : {}),
      });
    },
    metric(
      name: string,
      value: number,
      labels: Readonly<Record<string, string>> = {},
      context?: TelemetryContext,
    ): void {
      metrics.record(name, value, labels);
      const metric = metrics.snapshot().at(-1);
      if (!metric) return;
      emit({
        kind: "metric",
        serviceName: options.serviceName,
        timestamp: now().toISOString(),
        name,
        ...(context ? { context } : {}),
        metric,
      });
    },
  };
}
