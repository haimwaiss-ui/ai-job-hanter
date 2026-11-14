import { describe, expect, it } from "vitest";
import {
  aiProcessingQueuePayloadSchema,
  deadLetterPayloadSchema,
  scraperQueuePayloadSchema,
  submissionQueuePayloadSchema,
} from "./contracts";

const userId = "10000000-0000-4000-8000-000000000001";
const operationId = "20000000-0000-4000-8000-000000000002";
const tokenVaultRef = "30000000-0000-4000-8000-000000000003";
const key = "a".repeat(64);

describe("BullMQ payload schemas", () => {
  it("accepts a valid scraper payload", () => {
    expect(scraperQueuePayloadSchema.parse({
      userId, operationId, tokenVaultRef, idempotencyKey: key,
      source: "company_careers", searchProfileVersion: 1, runKey: "manual-run-001",
    }).source).toBe("company_careers");
  });

  it("rejects invalid IDs, missing vault references, and unexpected properties", () => {
    expect(scraperQueuePayloadSchema.safeParse({
      userId: "not-a-uuid", operationId, tokenVaultRef, idempotencyKey: key,
      source: "linkedin", searchProfileVersion: 1, runKey: "manual-run-001",
    }).success).toBe(false);

    expect(aiProcessingQueuePayloadSchema.safeParse({
      userId, operationId, idempotencyKey: key,
      jobId: operationId, resumeId: tokenVaultRef, mode: "match", modelVersion: "v1",
    }).success).toBe(false);

    expect(submissionQueuePayloadSchema.safeParse({
      userId, operationId, tokenVaultRef, idempotencyKey: key,
      applicationId: operationId, refreshToken: "must-never-be-present",
    }).success).toBe(false);
  });

  it("does not allow credentials in dead-letter payloads", () => {
    expect(deadLetterPayloadSchema.safeParse({
      originalQueue: "submission-queue",
      originalJobId: "submission-abc",
      userId,
      operationId,
      idempotencyKey: key,
      attemptsMade: 5,
      errorCode: "WORKER_FAILED",
      failedAt: new Date().toISOString(),
      tokenVaultRef,
    }).success).toBe(false);
  });
});
