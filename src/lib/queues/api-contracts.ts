import { z } from "zod";

/**
 * Public queue-ingress contract. Tenant identity, operation IDs, vault refs,
 * and idempotency keys are deliberately server-generated and are not accepted
 * from the browser.
 */
export const workerQueueRequestSchema = z.discriminatedUnion("queue", [
  z.object({
    queue: z.literal("scraper-queue"),
    source: z.enum(["linkedin", "alljobs", "facebook", "company_careers", "public_feed"]),
    searchProfileVersion: z.number().int().min(1).max(1_000_000),
    runKey: z.string().trim().min(8).max(160),
  }).strict(),
  z.object({
    queue: z.literal("ai-processing-queue"),
    jobId: z.string().uuid(),
    resumeId: z.string().uuid(),
    mode: z.enum(["pre_filter", "match", "tailor_resume"]),
    modelVersion: z.string().trim().min(1).max(80).optional(),
  }).strict(),
  z.object({
    queue: z.literal("submission-queue"),
    applicationId: z.string().uuid(),
  }).strict(),
]);

export type WorkerQueueRequest = z.infer<typeof workerQueueRequestSchema>;
