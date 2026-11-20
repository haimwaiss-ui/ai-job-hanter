import { describe, expect, it } from "vitest";
import { createBullJobId, createIdempotencyKey } from "@/lib/queues/producer";

describe("worker idempotency", () => {
  it("produces stable tenant-scoped keys", () => {
    const first = createIdempotencyKey("submission-queue", "user-a", "application-1:v1");
    const duplicate = createIdempotencyKey("submission-queue", "user-a", "application-1:v1");
    const otherTenant = createIdempotencyKey("submission-queue", "user-b", "application-1:v1");

    expect(first).toBe(duplicate);
    expect(first).not.toBe(otherTenant);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("creates BullMQ IDs without the reserved colon separator", () => {
    const key = "b".repeat(64);
    const id = createBullJobId(key);
    expect(id).toBe("ajh-" + key);
    expect(id).not.toContain(":");
  });
});
