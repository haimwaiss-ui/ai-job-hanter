import { z } from "zod";

const uuid = z.string().uuid();
const idempotencyKey = z.string().regex(/^[a-f0-9]{64}$/i);
const basePayload = z.object({
  userId: uuid,
  operationId: uuid,
  tokenVaultRef: uuid,
  idempotencyKey,
});

export const scraperQueuePayloadSchema = basePayload.extend({
  source: z.enum(["linkedin", "alljobs", "facebook", "company_careers", "public_feed"]),
  searchProfileVersion: z.number().int().min(1).max(1_000_000),
  runKey: z.string().trim().min(8).max(160),
}).strict();

export const aiProcessingQueuePayloadSchema = basePayload.extend({
  jobId: uuid,
  resumeId: uuid,
  mode: z.enum(["pre_filter", "match", "tailor_resume"]),
  modelVersion: z.string().trim().min(1).max(80),
}).strict();

export const submissionQueuePayloadSchema = basePayload.extend({
  applicationId: uuid,
}).strict();

/** Deliberately excludes tokenVaultRef and all credential material. */
export const deadLetterPayloadSchema = z.object({
  originalQueue: z.enum(["scraper-queue", "ai-processing-queue", "submission-queue"]),
  originalJobId: z.string().min(1).max(200),
  userId: uuid,
  operationId: uuid,
  idempotencyKey,
  attemptsMade: z.number().int().min(1).max(20),
  errorCode: z.string().regex(/^[A-Z0-9_]{2,64}$/),
  failedAt: z.string().datetime(),
}).strict();

export type ScraperQueuePayload = z.infer<typeof scraperQueuePayloadSchema>;
export type AiProcessingQueuePayload = z.infer<typeof aiProcessingQueuePayloadSchema>;
export type SubmissionQueuePayload = z.infer<typeof submissionQueuePayloadSchema>;
export type DeadLetterPayload = z.infer<typeof deadLetterPayloadSchema>;
export type WorkerQueueName = "scraper-queue" | "ai-processing-queue" | "submission-queue";
