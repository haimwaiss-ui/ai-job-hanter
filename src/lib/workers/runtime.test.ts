import { describe, expect, it, vi } from "vitest";
import { DEFAULT_JOB_OPTIONS } from "@/lib/queues/queues";
import { closeWorkerResources } from "./runtime";

describe("worker runtime controls", () => {
  it("uses bounded exponential retries with jitter", () => {
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(5);
    expect(DEFAULT_JOB_OPTIONS.backoff).toEqual({
      type: "exponential",
      delay: 2_000,
      jitter: 0.5,
    });
  });

  it("closes workers, dead-letter queue, and Redis during graceful shutdown", async () => {
    const workerA = { close: vi.fn().mockResolvedValue(undefined) };
    const workerB = { close: vi.fn().mockResolvedValue(undefined) };
    const deadLetterQueue = { close: vi.fn().mockResolvedValue(undefined) };
    const connection = {
      status: "ready",
      quit: vi.fn().mockResolvedValue(undefined),
    };

    await closeWorkerResources(
      [workerA, workerB],
      deadLetterQueue,
      connection as never,
    );

    expect(workerA.close).toHaveBeenCalledOnce();
    expect(workerB.close).toHaveBeenCalledOnce();
    expect(deadLetterQueue.close).toHaveBeenCalledOnce();
    expect(connection.quit).toHaveBeenCalledOnce();
  });
});
