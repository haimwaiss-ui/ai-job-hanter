import { describe, expect, it } from "vitest";
import { enqueueQueueRequestSchema } from "./api-schemas";

describe("worker queue API schemas", () => {
  it("accepts a valid scraper request without tenant-controlled identity fields", () => {
    const result = enqueueQueueRequestSchema.safeParse({
      queue: "scraper-queue",
      payload: {
        source: "public_feed",
        searchProfileVersion: 1,
        runKey: "weekly-search-2026-11",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects caller-supplied tenant, operation, or vault identity", () => {
    const result = enqueueQueueRequestSchema.safeParse({
      queue: "scraper-queue",
      userId: "10000000-0000-4000-8000-000000000001",
      payload: {
        source: "public_feed",
        searchProfileVersion: 1,
        runKey: "weekly-search-2026-11",
        tokenVaultRef: "20000000-0000-4000-8000-000000000002",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects unsupported queues and malformed tenant-owned record IDs", () => {
    expect(enqueueQueueRequestSchema.safeParse({
      queue: "admin-queue",
      payload: {},
    }).success).toBe(false);

    expect(enqueueQueueRequestSchema.safeParse({
      queue: "ai-processing-queue",
      payload: {
        jobId: "not-a-uuid",
        resumeId: "20000000-0000-4000-8000-000000000002",
        mode: "match",
        modelVersion: "v1",
      },
    }).success).toBe(false);
  });
});
