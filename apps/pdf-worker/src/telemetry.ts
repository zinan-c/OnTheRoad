export const telemetryPartition = {
  serviceName: "pdf-worker",
  metricPrefix: "otr_pdf_worker",
  resourceAttributes: {
    "service.name": "on-the-road-pdf-worker",
    "service.namespace": "on-the-road",
  },
} as const;
