import { describe, expect, it } from "vitest";
import { workerQueueRequestSchema } from "./api-contracts";

const jobId = "10000000-0000-4000-8000-000000000001";
const resumeId = "20000000-0000-4000-8000-000000000002";
const applicationId = "30000000-0000-4000-8000-000000000003";

describe("worker queue API contract", () => {
  it("accepts each supported queue request", () => {
    expect(workerQueueRequestSchema.parse({
      queue: "scraper-queue",
      source: "alljobs",
      searchProfileVersion: 1,
      runKey: "manual-run-2026-11",
    }).queue).toBe("scraper-queue");

    expect(workerQueueRequestSchema.parse({
      queue: "ai-processing-queue",
      jobId,
      resumeId,
      mode: "match",
    }).queue).toBe("ai-processing-queue");

    expect(workerQueueRequestSchema.parse({
      queue: "submission-queue",
      applicationId,
    }).queue).toBe("submission-queue");
  });

  it("rejects caller-controlled tenant, vault, operation, and credential fields", () => {
    const base = {
      queue: "scraper-queue",
      source: "linkedin",
      searchProfileVersion: 1,
      runKey: "manual-run-2026-11",
    };

    for (const field of [
      "userId",
      "tokenVaultRef",
      "operationId",
      "idempotencyKey",
      "accessToken",
      "refreshToken",
      "serviceRoleKey",
    ]) {
      expect(workerQueueRequestSchema.safeParse({
        ...base,
        [field]: "must-not-be-client-controlled",
      }).success).toBe(false);
    }
  });

  it("rejects invalid identifiers, unsupported queues, and malformed run keys", () => {
    expect(workerQueueRequestSchema.safeParse({
      queue: "ai-processing-queue",
      jobId: "not-a-uuid",
      resumeId,
      mode: "match",
    }).success).toBe(false);

    expect(workerQueueRequestSchema.safeParse({
      queue: "unknown-queue",
      applicationId,
    }).success).toBe(false);

    expect(workerQueueRequestSchema.safeParse({
      queue: "scraper-queue",
      source: "linkedin",
      searchProfileVersion: 1,
      runKey: "short",
    }).success).toBe(false);
  });
});
