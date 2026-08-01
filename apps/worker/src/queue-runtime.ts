import { Worker, type Job, type Processor } from "bullmq";
import { Redis } from "ioredis";

export const APPLICATION_QUEUE = "otr.application";

export interface QueueConsumer {
  pause(doNotWaitActive?: boolean): Promise<void>;
  close(force?: boolean): Promise<void>;
}

export interface QueueProcess {
  readonly queueName: string;
  readonly consumer: QueueConsumer;
  close(): Promise<void>;
}

export async function defaultApplicationProcessor(job: Job): Promise<unknown> {
  throw Object.assign(
    new Error(`No application processor is registered for ${job.name}`),
    { code: "WORKER_PROCESSOR_UNSUPPORTED", retryable: false },
  );
}

export function createQueueProcess(options: {
  readonly redisUrl: string;
  readonly queueName?: string;
  readonly processor?: Processor;
  readonly consumerFactory?: (
    queueName: string,
    processor: Processor,
    connection: Redis,
  ) => QueueConsumer;
}): QueueProcess {
  const queueName = options.queueName ?? APPLICATION_QUEUE;
  const connection = new Redis(options.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  const processor = options.processor ?? defaultApplicationProcessor;
  const consumer = options.consumerFactory
    ? options.consumerFactory(queueName, processor, connection)
    : new Worker(queueName, processor, {
      connection,
      concurrency: 4,
    });
  let closing = false;
  return {
    queueName,
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
