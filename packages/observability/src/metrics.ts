export interface TelemetryDiagnostic {
  readonly code: "metrics.label_dropped" | "telemetry.sink_failure";
  readonly message: string;
  readonly serviceName?: string;
  readonly sinkName?: string;
  readonly metricName?: string;
  readonly labelName?: string;
}

export interface MetricPoint {
  readonly name: string;
  readonly value: number;
  readonly labels: Readonly<Record<string, string>>;
}

export interface MetricsRegistryOptions {
  readonly allowedLabels: Readonly<Record<string, readonly string[]>>;
  readonly diagnose?: (diagnostic: TelemetryDiagnostic) => void;
}

const HIGH_CARDINALITY_LABEL =
  /(?:^|_)(?:address|contact|email|id|key|phone|request|secret|token|trace|url)(?:$|_)/iu;

function isHighCardinalityLabel(labelName: string): boolean {
  return HIGH_CARDINALITY_LABEL.test(
    labelName.replace(/([a-z0-9])([A-Z])/gu, "$1_$2"),
  );
}

export class MetricsRegistry {
  readonly #points: MetricPoint[] = [];
  readonly #allowedLabels: Readonly<Record<string, readonly string[]>>;
  readonly #diagnose: (diagnostic: TelemetryDiagnostic) => void;

  constructor(options: MetricsRegistryOptions) {
    this.#allowedLabels = options.allowedLabels;
    this.#diagnose = options.diagnose ?? (() => undefined);
  }

  record(
    name: string,
    value: number,
    labels: Readonly<Record<string, string>> = {},
  ): void {
    if (!Number.isFinite(value)) throw new TypeError("Metric value must be finite");
    const allowed = new Set(this.#allowedLabels[name] ?? []);
    const safeLabels: Record<string, string> = {};

    for (const [labelName, labelValue] of Object.entries(labels)) {
      if (!allowed.has(labelName) || isHighCardinalityLabel(labelName)) {
        this.#diagnose({
          code: "metrics.label_dropped",
          message: `Metric label '${labelName}' is not allowed`,
          metricName: name,
          labelName,
        });
        continue;
      }
      safeLabels[labelName] = labelValue;
    }

    this.#points.push({ name, value, labels: safeLabels });
  }

  snapshot(): readonly MetricPoint[] {
    return structuredClone(this.#points);
  }
}
