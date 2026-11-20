import { describe, expect, it, vi } from "vitest";
import { DEFAULT_JOB_OPTIONS } from "@/lib/queues/queues";
import { closeWorkerResources, isTerminalWorkerFailure } from "./runtime";

describe("worker runtime controls", () => {
  it("uses bounded exponential retries with jitter", () => {
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(5);
    expect(DEFAULT_JOB_OPTIONS.backoff).toEqual({
      type: "exponential",
      delay: 2_000,
      jitter: 0.5,
    });
  });

  it("treats stalled-limit failures as terminal before the retry budget is consumed", () => {
    expect(isTerminalWorkerFailure({
      attemptsMade: 1,
      configuredAttempts: 5,
      failedReason: "job stalled more than allowable limit",
    })).toBe(true);
    expect(isTerminalWorkerFailure({
      attemptsMade: 2,
      configuredAttempts: 5,
      failedReason: "temporary provider error",
    })).toBe(false);
    expect(isTerminalWorkerFailure({
      attemptsMade: 5,
      configuredAttempts: 5,
    })).toBe(true);
  });

  it("closes workers, dead-letter queue, and Redis during graceful shutdown", async () => {
    const order: string[] = [];
    const workerA = { close: vi.fn().mockImplementation(async () => { order.push("worker-a"); }) };
    const workerB = { close: vi.fn().mockImplementation(async () => { order.push("worker-b"); }) };
    const deadLetterQueue = { close: vi.fn().mockImplementation(async () => { order.push("dead-letter"); }) };
    const connection = {
      status: "ready",
      quit: vi.fn().mockImplementation(async () => { order.push("redis"); }),
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
    expect(order).toEqual(["worker-a", "worker-b", "dead-letter", "redis"]);
  });
});
