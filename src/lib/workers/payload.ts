import {
  aiProcessingQueuePayloadSchema,
  scraperQueuePayloadSchema,
  submissionQueuePayloadSchema,
  type AiProcessingQueuePayload,
  type ScraperQueuePayload,
  type SubmissionQueuePayload,
} from "@/lib/queues/contracts";
import type { WorkerQueueName } from "@/lib/queues/contracts";

export type ParsedWorkerPayload =
  | ScraperQueuePayload
  | AiProcessingQueuePayload
  | SubmissionQueuePayload;

/** Zod validation is repeated at the worker boundary, even after API validation. */
export function parseWorkerPayload(
  queueName: WorkerQueueName,
  input: unknown,
): ParsedWorkerPayload {
  switch (queueName) {
    case "scraper-queue":
      return scraperQueuePayloadSchema.parse(input);
    case "ai-processing-queue":
      return aiProcessingQueuePayloadSchema.parse(input);
    case "submission-queue":
      return submissionQueuePayloadSchema.parse(input);
  }
}
