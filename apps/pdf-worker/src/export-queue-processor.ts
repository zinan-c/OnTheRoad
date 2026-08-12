import { EXPORT_QUEUE_JOB_NAME } from "@on-the-road/application/export";
import type { Job, Processor } from "bullmq";
import { defaultPdfProcessor } from "./queue-runtime.js";

type PdfJobProcessor = Readonly<{
  process(jobId: string, signal?: AbortSignal): Promise<unknown>;
}>;

export function createExportQueueProcessor(processor: PdfJobProcessor): Processor {
  return async (job: Job) => {
    if (job.name !== EXPORT_QUEUE_JOB_NAME) return defaultPdfProcessor(job);
    const exportJobId = typeof job.data?.exportJobId === "string" ? job.data.exportJobId : "";
    if (!exportJobId) {
      throw Object.assign(new Error("Export render jobs require exportJobId."), {
        code: "PDF_EXPORT_JOB_ID_REQUIRED",
        retryable: false,
      });
    }
    return processor.process(exportJobId);
  };
}
