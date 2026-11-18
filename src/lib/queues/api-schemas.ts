import { z } from "zod";

const uuid = z.string().uuid();

const scraperRequest = z.object({
  queue: z.literal("scraper-queue"),
  payload: z.object({
    source: z.enum(["linkedin", "alljobs", "facebook", "company_careers", "public_feed"]),
    searchProfileVersion: z.number().int().min(1).max(1_000_000),
    runKey: z.string().trim().min(8).max(160),
  }).strict(),
}).strict();

const aiProcessingRequest = z.object({
  queue: z.literal("ai-processing-queue"),
  payload: z.object({
    jobId: uuid,
    resumeId: uuid,
    mode: z.enum(["pre_filter", "match", "tailor_resume"]),
    modelVersion: z.string().trim().min(1).max(80),
  }).strict(),
}).strict();

const submissionRequest = z.object({
  queue: z.literal("submission-queue"),
  payload: z.object({
    applicationId: uuid,
  }).strict(),
}).strict();

/** Public API input. Tenant IDs, operation IDs and vault references are server-derived. */
export const enqueueQueueRequestSchema = z.discriminatedUnion("queue", [
  scraperRequest,
  aiProcessingRequest,
  submissionRequest,
]);

export type EnqueueQueueRequest = z.infer<typeof enqueueQueueRequestSchema>;
