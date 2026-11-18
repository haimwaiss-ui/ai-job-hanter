import { describe, expect, it } from "vitest";
import { createBullJobId, createIdempotencyKey } from "./producer";

const userA = "10000000-0000-4000-8000-000000000001";
const userB = "20000000-0000-4000-8000-000000000002";

describe("worker queue producer identity", () => {
  it("creates a stable SHA-256 key for the same tenant operation", () => {
    const first = createIdempotencyKey("ai-processing-queue", userA, "job:resume:match:v1");
    const second = createIdempotencyKey("ai-processing-queue", userA, "job:resume:match:v1");

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });

  it("isolates keys by tenant and queue", () => {
    const key = createIdempotencyKey("submission-queue", userA, "application:submit:v1");

    expect(createIdempotencyKey("submission-queue", userB, "application:submit:v1")).not.toBe(key);
    expect(createIdempotencyKey("ai-processing-queue", userA, "application:submit:v1")).not.toBe(key);
  });

  it("creates a BullMQ-safe deterministic job ID", () => {
    const key = createIdempotencyKey("scraper-queue", userA, "daily-run");
    const jobId = createBullJobId(key);

    expect(jobId).toBe("ajh-" + key);
    expect(jobId).not.toContain(":");
    expect(() => createBullJobId("invalid")).toThrow("Invalid queue idempotency key");
  });
});
