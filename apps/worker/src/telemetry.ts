export const telemetryPartition = {
  serviceName: "worker",
  metricPrefix: "otr_worker",
  resourceAttributes: {
    "service.name": "on-the-road-worker",
    "service.namespace": "on-the-road",
  },
} as const;
