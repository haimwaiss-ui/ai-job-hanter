import { randomUUID } from "node:crypto";
import IORedis from "ioredis";
import { Queue } from "bullmq";
import { describe, expect, it } from "vitest";

const redisUrl = process.env.REDIS_URL;

describe.skipIf(!redisUrl)("BullMQ Redis deduplication", () => {
  it("returns the existing job for a repeated deterministic job ID", async () => {
    const queueName = "worker-dedupe-test-" + randomUUID();
    const connection = new IORedis(redisUrl!, { maxRetriesPerRequest: null });
    const queueConnection = connection.duplicate();
    const queue = new Queue(queueName, { connection: queueConnection });

    try {
      const first = await queue.add("test", { tenant: "user-a" }, { jobId: "stable-idempotency-key" });
      const second = await queue.add("test", { tenant: "user-a" }, { jobId: "stable-idempotency-key" });
      expect(second.id).toBe(first.id);
      expect(await queue.getJobCounts("waiting")).toBeTruthy();
    } finally {
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
      await connection.quit();
    }
  });
});
