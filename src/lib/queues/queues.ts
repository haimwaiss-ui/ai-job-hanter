import { Queue, type JobsOptions } from "bullmq";
import type {
  AiProcessingQueuePayload,
  DeadLetterPayload,
  ScraperQueuePayload,
  SubmissionQueuePayload,
} from "./contracts";
import { createRedisConnection } from "./connection";
import type IORedis from "ioredis";

export const QUEUE_NAMES = {
  scraper: "scraper-queue",
  aiProcessing: "ai-processing-queue",
  submission: "submission-queue",
  deadLetter: "dead-letter-queue",
} as const;

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: {
    type: "exponential",
    delay: 2_000,
    jitter: 0.5,
  },
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 10_000 },
  removeOnFail: { age: 30 * 24 * 60 * 60, count: 20_000 },
};

export function createQueueSet(connection: IORedis = createRedisConnection()) {
  const options = { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS };

  return {
    connection,
    scraper: new Queue<ScraperQueuePayload>(QUEUE_NAMES.scraper, options),
    aiProcessing: new Queue<AiProcessingQueuePayload>(QUEUE_NAMES.aiProcessing, options),
    submission: new Queue<SubmissionQueuePayload>(QUEUE_NAMES.submission, options),
    deadLetter: new Queue<DeadLetterPayload>(QUEUE_NAMES.deadLetter, {
      connection: connection.duplicate(),
      defaultJobOptions: {
        removeOnComplete: false,
        removeOnFail: false,
      },
    }),
  };
}

export type QueueSet = ReturnType<typeof createQueueSet>;

export async function closeQueueSet(queues: QueueSet): Promise<void> {
  await Promise.allSettled([
    queues.scraper.close(),
    queues.aiProcessing.close(),
    queues.submission.close(),
    queues.deadLetter.close(),
  ]);
  if (queues.connection.status !== "end") {
    await queues.connection.quit();
  }
}
