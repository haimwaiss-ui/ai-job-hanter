import { describe, expect, it } from "vitest";
import { enqueueQueueRequestSchema } from "./api-schemas";

const jobId = "10000000-0000-4000-8000-000000000001";
const resumeId = "20000000-0000-4000-8000-000000000002";
const applicationId = "30000000-0000-4000-8000-000000000003";

describe("worker queue API schemas", () => {
  it("accepts a valid scraper request", () => {
    expect(enqueueQueueRequestSchema.safeParse({
      queue: "scraper-queue",
      payload: {
        source: "public_feed",
        searchProfileVersion: 1,
        runKey: "40000000-0000-4000-8000-000000000004",
      },
    }).success).toBe(true);
  });

  it("rejects tenant and credential fields supplied by the caller", () => {
    expect(enqueueQueueRequestSchema.safeParse({
      queue: "scraper-queue",
      userId: jobId,
      payload: {
        source: "public_feed",
        searchProfileVersion: 1,
        runKey: "40000000-0000-4000-8000-000000000004",
        tokenVaultRef: resumeId,
        idempotencyKey: "a".repeat(64),
      },
    }).success).toBe(false);
  });

  it("validates tenant record IDs and supported queue operations", () => {
    expect(enqueueQueueRequestSchema.safeParse({
      queue: "ai-processing-queue",
      payload: { jobId, resumeId, mode: "match", modelVersion: "gpt-4o-mini" },
    }).success).toBe(true);

    expect(enqueueQueueRequestSchema.safeParse({
      queue: "ai-processing-queue",
      payload: { jobId: "not-a-uuid", resumeId, mode: "match", modelVersion: "v1" },
    }).success).toBe(false);

    expect(enqueueQueueRequestSchema.safeParse({
      queue: "admin-queue",
      payload: {},
    }).success).toBe(false);

    expect(enqueueQueueRequestSchema.safeParse({
      queue: "submission-queue",
      payload: { applicationId, userId: jobId },
    }).success).toBe(false);
  });
});
