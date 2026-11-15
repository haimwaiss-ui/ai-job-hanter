import { describe, expect, it } from "vitest";
import { createBullJobId, createIdempotencyKey } from "./producer";

const userA = "10000000-0000-4000-8000-000000000001";
const userB = "20000000-0000-4000-8000-000000000002";

describe("queue idempotency", () => {
  it("generates the same key and BullMQ job ID for the same tenant operation", () => {
    const first = createIdempotencyKey("scraper-queue", userA, "scan-2026-11-15");
    const second = createIdempotencyKey("scraper-queue", userA, "scan-2026-11-15");

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
    expect(createBullJobId(first)).toBe(createBullJobId(second));
  });

  it("isolates identical operations across tenants and queues", () => {
    const tenantA = createIdempotencyKey("ai-processing-queue", userA, "job:resume:match:v1");
    const tenantB = createIdempotencyKey("ai-processing-queue", userB, "job:resume:match:v1");
    const otherQueue = createIdempotencyKey("submission-queue", userA, "job:resume:match:v1");

    expect(tenantA).not.toBe(tenantB);
    expect(tenantA).not.toBe(otherQueue);
  });

  it("rejects malformed keys before constructing a BullMQ job ID", () => {
    expect(() => createBullJobId("not-a-hash")).toThrow("Invalid queue idempotency key");
  });
});
