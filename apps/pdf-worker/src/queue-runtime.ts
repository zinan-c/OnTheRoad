import { Worker, type Job, type Processor } from "bullmq";
import { Redis } from "ioredis";
import { EXPORT_QUEUE_NAME } from "@on-the-road/application/export";

export const PDF_QUEUE = EXPORT_QUEUE_NAME;

export interface QueueConsumer {
  pause(doNotWaitActive?: boolean): Promise<void>;
  close(force?: boolean): Promise<void>;
}

export async function defaultPdfProcessor(job: Job): Promise<unknown> {
  if (job.name === "runtime.noop") {
    return { ok: true, jobId: job.id ?? null };
  }
  throw Object.assign(
    new Error(`No PDF processor is registered for ${job.name}`),
    { code: "PDF_PROCESSOR_UNSUPPORTED", retryable: false },
  );
}

export function createPdfQueueProcess(options: {
  readonly redisUrl: string;
  readonly processor?: Processor;
  readonly consumerFactory?: (
    queueName: string,
    processor: Processor,
    connection: Redis,
  ) => QueueConsumer;
}) {
  const connection = new Redis(options.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  const processor = options.processor ?? defaultPdfProcessor;
  const consumer = options.consumerFactory
    ? options.consumerFactory(PDF_QUEUE, processor, connection)
    : new Worker(PDF_QUEUE, processor, {
      connection,
      concurrency: 2,
    });
  let closing = false;
  return {
    queueName: PDF_QUEUE,
    consumer,
    async close() {
      if (closing) return;
      closing = true;
      await consumer.pause(true);
      await consumer.close();
      if (connection.status !== "end") {
        try {
          await connection.quit();
        } catch {
          connection.disconnect();
        }
      }
    },
  };
}
