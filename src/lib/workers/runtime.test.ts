import { describe, expect, it, vi } from "vitest";
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES } from "@/lib/queues/queues";
import {
  closeWorkerResources,
  drainPendingWorkerSideEffects,
  isAmbiguousSubmissionTimeout,
  PermanentWorkerError,
  trackPendingWorkerSideEffect,
  WorkerTimeoutError,
} from "./runtime";
import { toSafeWorkerError } from "./execution-log";

describe("worker runtime controls", () => {
  it("uses bounded exponential retries with jitter", () => {
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(5);
    expect(DEFAULT_JOB_OPTIONS.backoff).toEqual({
      type: "exponential",
      delay: 2_000,
      jitter: 0.5,
    });
  });

  it("stops automatic retries for ambiguous submission timeouts only", () => {
    const timeout = new WorkerTimeoutError();

    expect(isAmbiguousSubmissionTimeout(QUEUE_NAMES.submission, timeout)).toBe(true);
    expect(isAmbiguousSubmissionTimeout(QUEUE_NAMES.scraper, timeout)).toBe(false);
    expect(isAmbiguousSubmissionTimeout(QUEUE_NAMES.submission, new Error("timeout"))).toBe(false);
  });

  it("marks missing provider configuration as a permanent, sanitized failure", () => {
    const error = new PermanentWorkerError("OPENAI_NOT_CONFIGURED", "The AI provider is not configured.");
    expect(toSafeWorkerError(error)).toEqual({
      code: "OPENAI_NOT_CONFIGURED",
      message: "Background operation failed. A retry or manual review may follow.",
    });
  });

  it("drains asynchronous terminal-failure writes before closing the DLQ and Redis", async () => {
    const order: string[] = [];
    const pending = new Set<Promise<void>>();
    let releaseSideEffect!: () => void;
    const sideEffect = new Promise<void>((resolve) => {
      releaseSideEffect = resolve;
    });

    trackPendingWorkerSideEffect(pending, sideEffect, () => {
      order.push("side-effect-error");
    });

    const worker = {
      close: vi.fn(async () => {
        order.push("worker");
      }),
    };
    const deadLetterQueue = {
      close: vi.fn(async () => {
        order.push("dead-letter");
      }),
    };
    const connection = {
      status: "ready",
      quit: vi.fn(async () => {
        order.push("redis");
      }),
    };

    let markDrainStarted!: () => void;
    const drainStarted = new Promise<void>((resolve) => {
      markDrainStarted = resolve;
    });
    const closing = closeWorkerResources(
      [worker],
      deadLetterQueue,
      connection as never,
      async () => {
        order.push("drain-start");
        markDrainStarted();
        await drainPendingWorkerSideEffects(pending);
        order.push("drain-end");
      },
    );

    await drainStarted;
    expect(order).toEqual(["worker", "drain-start"]);
    expect(deadLetterQueue.close).not.toHaveBeenCalled();
    expect(connection.quit).not.toHaveBeenCalled();

    releaseSideEffect();
    await closing;

    expect(order).toEqual(["worker", "drain-start", "drain-end", "dead-letter", "redis"]);
    expect(worker.close).toHaveBeenCalledOnce();
    expect(deadLetterQueue.close).toHaveBeenCalledOnce();
    expect(connection.quit).toHaveBeenCalledOnce();
    expect(pending.size).toBe(0);
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
