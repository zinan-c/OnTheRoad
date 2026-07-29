export const telemetryPartition = {
  serviceName: "api",
  metricPrefix: "otr_api",
  resourceAttributes: {
    "service.name": "on-the-road-api",
    "service.namespace": "on-the-road",
  },
} as const;
