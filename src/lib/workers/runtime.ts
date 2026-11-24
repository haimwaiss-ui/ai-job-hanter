import {
  Job,
  Queue,
  UnrecoverableError,
  Worker,
  type Processor,
} from "bullmq";
import { createHash } from "node:crypto";
import type IORedis from "ioredis";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ZodType } from "zod";
import type {
  AiProcessingQueuePayload,
  DeadLetterPayload,
  ScraperQueuePayload,
  SubmissionQueuePayload,
  WorkerQueueName,
} from "@/lib/queues/contracts";
import {
  aiProcessingQueuePayloadSchema,
  deadLetterPayloadSchema,
  scraperQueuePayloadSchema,
  submissionQueuePayloadSchema,
} from "@/lib/queues/contracts";
import { QUEUE_NAMES, DEFAULT_JOB_OPTIONS } from "@/lib/queues/queues";
import type { Database } from "@/lib/supabase/database.types";
import type { ExecutionType } from "@/lib/supabase/types";
import { createTenantWorkerClient, assertWorkerTenant } from "./tenant-client";
import type { UserTokenVault } from "./token-vault";
import { writeExecutionLog, toSafeWorkerError } from "./execution-log";
import { ManualAssistRequiredError, PermanentSubmissionError } from "./submission";

type WorkerPayload =
  | ScraperQueuePayload
  | AiProcessingQueuePayload
  | SubmissionQueuePayload;

type WorkerOperationStatus =
  | "running"
  | "retrying"
  | "completed"
  | "failed"
  | "manual_assist";

export class PermanentWorkerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PermanentWorkerError";
  }
}

export interface WorkerHandlerContext {
  supabase: SupabaseClient<Database>;
  userId: string;
  operationId: string;
  attempt: number;
  signal: AbortSignal;
}

export interface WorkerHandlers {
  scrape(payload: ScraperQueuePayload, context: WorkerHandlerContext): Promise<void>;
  processAi(payload: AiProcessingQueuePayload, context: WorkerHandlerContext): Promise<void>;
  submit(payload: SubmissionQueuePayload, context: WorkerHandlerContext): Promise<void>;
}

export interface SafeLogger {
  info(event: string, fields: Record<string, string | number | boolean | null>): void;
  warn(event: string, fields: Record<string, string | number | boolean | null>): void;
  error(event: string, fields: Record<string, string | number | boolean | null>): void;
}

const defaultLogger: SafeLogger = {
  info: (event, fields) => console.info(JSON.stringify({ level: "info", event, ...fields })),
  warn: (event, fields) => console.warn(JSON.stringify({ level: "warn", event, ...fields })),
  error: (event, fields) => console.error(JSON.stringify({ level: "error", event, ...fields })),
};

class WorkerTimeoutError extends Error {
  readonly code = "WORKER_TIMEOUT";
  constructor() {
    super("Background worker timed out");
    this.name = "WorkerTimeoutError";
  }
}

function withTimeout<T>(
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new WorkerTimeoutError());
    }, timeoutMs);
  });

  return Promise.race([task(controller.signal), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function executionRefs(payload: WorkerPayload) {
  return {
    jobId: "jobId" in payload ? payload.jobId : null,
    applicationId: "applicationId" in payload ? payload.applicationId : null,
  };
}

async function updateOperation(
  supabase: SupabaseClient<Database>,
  payload: WorkerPayload,
  queueName: WorkerQueueName,
  status: WorkerOperationStatus,
  error?: { code: string; message: string },
): Promise<void> {
  const terminal = status === "completed" || status === "failed" || status === "manual_assist";
  const { error: updateError } = await supabase
    .from("worker_operations")
    .update({
      status,
      lease_until: null,
      last_error_code: error?.code ?? null,
      last_error_message: error?.message ?? null,
      updated_at: new Date().toISOString(),
      completed_at: terminal ? new Date().toISOString() : null,
    })
    .eq("user_id", payload.userId)
    .eq("queue_name", queueName)
    .eq("idempotency_key", payload.idempotencyKey);

  if (updateError) throw new Error("Worker operation state update failed");
}

async function publishDeadLetter(
  queue: Queue<DeadLetterPayload>,
  queueName: WorkerQueueName,
  job: Job<WorkerPayload>,
  payload: WorkerPayload,
  errorCode: string,
  attemptsMade: number,
): Promise<void> {
  const deadLetter = deadLetterPayloadSchema.parse({
    originalQueue: queueName,
    originalJobId: job.id ?? "unknown",
    userId: payload.userId,
    operationId: payload.operationId,
    idempotencyKey: payload.idempotencyKey,
    attemptsMade: Math.max(1, attemptsMade),
    errorCode,
    failedAt: new Date().toISOString(),
  });
  const dedupe = createHash("sha256")
    .update(queueName + ":" + deadLetter.originalJobId)
    .digest("hex");

  await queue.add("dead-letter", deadLetter, {
    jobId: "dlq-" + dedupe,
    removeOnComplete: false,
    removeOnFail: false,
  });
}

async function recordTerminalFailureIfNeeded(
  tokenVault: UserTokenVault,
  queueName: WorkerQueueName,
  payload: WorkerPayload,
  errorCode: string,
): Promise<void> {
  await tokenVault.withAccessToken(payload.tokenVaultRef, payload.userId, async (accessToken) => {
    const supabase = createTenantWorkerClient(accessToken);
    await assertWorkerTenant(supabase, payload.userId, accessToken);

    const { data: operation, error: readError } = await supabase
      .from("worker_operations")
      .select("status")
      .eq("user_id", payload.userId)
      .eq("queue_name", queueName)
      .eq("idempotency_key", payload.idempotencyKey)
      .single();

    if (readError || !operation) throw new Error("Terminal operation state unavailable");
    if (operation.status === "failed" || operation.status === "completed" || operation.status === "manual_assist") {
      return;
    }

    const safe = toSafeWorkerError({ code: errorCode });
    await updateOperation(supabase, payload, queueName, "failed", safe);
    const refs = executionRefs(payload);
    await writeExecutionLog(supabase, {
      userId: payload.userId,
      executionType: executionTypeFor(queueName),
      status: "failed",
      operation: queueName,
      attemptNumber: 1,
      jobId: refs.jobId,
      applicationId: refs.applicationId,
      error: safe,
      metadata: {
        queueName,
        operationId: payload.operationId,
        idempotencyKey: payload.idempotencyKey,
        terminalFailureSource: "stalled-job",
      },
    });
  });
}

function executionTypeFor(queueName: WorkerQueueName): ExecutionType {
  if (queueName === QUEUE_NAMES.scraper) return "scraping";
  if (queueName === QUEUE_NAMES.aiProcessing) return "ai_matching";
  return "form_submission";
}

export function trackPendingWorkerSideEffect(
  pending: Set<Promise<void>>,
  task: Promise<void>,
  onError: () => void,
): void {
  let tracked!: Promise<void>;
  tracked = task
    .catch(() => onError())
    .finally(() => pending.delete(tracked));
  pending.add(tracked);
}

export async function drainPendingWorkerSideEffects(
  pending: Set<Promise<void>>,
): Promise<void> {
  // A failed event may enqueue more than one side effect. Drain until the set
  // is empty, including tasks registered while an earlier batch is settling.
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
}

function createTypedWorker<P extends WorkerPayload>(
  queueName: WorkerQueueName,
  schema: ZodType<P>,
  executionType: ExecutionType,
  handler: (payload: P, context: WorkerHandlerContext) => Promise<void>,
  timeoutMs: number,
  options: {
    concurrency: number;
    rateLimitMax: number;
    rateLimitDuration: number;
  },
  dependencies: {
    connection: IORedis;
    deadLetterQueue: Queue<DeadLetterPayload>;
    tokenVault: UserTokenVault;
    logger: SafeLogger;
    pendingFailureTasks: Set<Promise<void>>;
  },
): Worker<P, unknown, string> {
  const processor: Processor<P, unknown, string> = async (job) => {
    const parsed = schema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError("Invalid worker queue payload");
    }
    const payload = parsed.data as P;
    const attempt = job.attemptsMade + 1;
    const startedAt = Date.now();

    return dependencies.tokenVault.withAccessToken(
      payload.tokenVaultRef,
      payload.userId,
      async (accessToken) => {
        const supabase = createTenantWorkerClient(accessToken);
        await assertWorkerTenant(supabase, payload.userId, accessToken);

        const { data: claimed, error: claimError } = await supabase.rpc("claim_worker_operation", {
          p_queue_name: queueName,
          p_idempotency_key: payload.idempotencyKey,
          p_operation_id: payload.operationId,
        });
        if (claimError) throw new Error("Worker idempotency claim failed");
        if (!claimed) {
          dependencies.logger.info("duplicate_job_skipped", {
            queueName,
            jobId: job.id ?? null,
            userId: payload.userId,
          });
          return { duplicate: true };
        }

        const refs = executionRefs(payload);
        try {
          await writeExecutionLog(supabase, {
            userId: payload.userId,
            executionType,
            status: "running",
            operation: queueName,
            attemptNumber: attempt,
            jobId: refs.jobId,
            applicationId: refs.applicationId,
            metadata: {
              queueName,
              operationId: payload.operationId,
              idempotencyKey: payload.idempotencyKey,
              bullJobId: job.id ?? null,
              attempt,
            },
          });

          await withTimeout(timeoutMs, (signal) =>
            handler(payload, {
              // Use a per-attempt client so Supabase's own HTTP requests abort
              // when the handler timeout fires. Keep the base client above for
              // failure-state writes after the handler has been cancelled.
              supabase: createTenantWorkerClient(accessToken, signal),
              userId: payload.userId,
              operationId: payload.operationId,
              attempt,
              signal,
            }),
          );

          await writeExecutionLog(supabase, {
            userId: payload.userId,
            executionType,
            status: "success",
            operation: queueName,
            attemptNumber: attempt,
            durationMs: Date.now() - startedAt,
            jobId: refs.jobId,
            applicationId: refs.applicationId,
            metadata: {
              queueName,
              operationId: payload.operationId,
              idempotencyKey: payload.idempotencyKey,
              bullJobId: job.id ?? null,
            },
          });
          await updateOperation(supabase, payload, queueName, "completed");
          return { completed: true };
        } catch (error) {
          if (error instanceof ManualAssistRequiredError) {
            const safe = toSafeWorkerError(error);
            await updateOperation(supabase, payload, queueName, "manual_assist", safe);
            try {
              await writeExecutionLog(supabase, {
                userId: payload.userId,
                executionType,
                status: "fallback",
                operation: queueName,
                attemptNumber: attempt,
                durationMs: Date.now() - startedAt,
                jobId: refs.jobId,
                applicationId: refs.applicationId,
                error: safe,
                fallbackReason: error.code,
                metadata: {
                  queueName,
                  operationId: payload.operationId,
                  idempotencyKey: payload.idempotencyKey,
                  manualAssist: true,
                },
              });
            } catch {
              dependencies.logger.error("manual_assist_log_write_failed", {
                queueName,
                jobId: job.id ?? null,
                userId: payload.userId,
              });
            }
            dependencies.logger.warn("submission_manual_assist", {
              queueName,
              jobId: job.id ?? null,
              userId: payload.userId,
              reason: error.code,
            });
            return { manualAssist: true };
          }

          const safe = toSafeWorkerError(error);
          const configuredAttempts = typeof job.opts.attempts === "number"
            ? job.opts.attempts
            : Number(DEFAULT_JOB_OPTIONS.attempts ?? 5);
          const permanent = error instanceof PermanentSubmissionError || error instanceof PermanentWorkerError;
          const finalAttempt = permanent || attempt >= configuredAttempts;
          const status: WorkerOperationStatus = finalAttempt ? "failed" : "retrying";

          try {
            await updateOperation(supabase, payload, queueName, status, safe);
            await writeExecutionLog(supabase, {
              userId: payload.userId,
              executionType,
              status: finalAttempt ? "failed" : "retrying",
              operation: queueName,
              attemptNumber: attempt,
              durationMs: Date.now() - startedAt,
              jobId: refs.jobId,
              applicationId: refs.applicationId,
              error: safe,
              metadata: {
                queueName,
                operationId: payload.operationId,
                idempotencyKey: payload.idempotencyKey,
                bullJobId: job.id ?? null,
                retryScheduled: !finalAttempt,
              },
            });
          } catch {
            throw new Error("Worker failure state could not be persisted");
          }

          if (finalAttempt) {
            await publishDeadLetter(
              dependencies.deadLetterQueue,
              queueName,
              job as Job<WorkerPayload>,
              payload,
              safe.code,
              attempt,
            );
          }

          dependencies.logger.warn(finalAttempt ? "job_failed" : "job_retrying", {
            queueName,
            jobId: job.id ?? null,
            userId: payload.userId,
            attempt,
            errorCode: safe.code,
          });

          // Only a sanitized, static message reaches BullMQ's Redis failedReason.
          if (permanent) throw new UnrecoverableError(safe.message);
          throw new Error(safe.message);
        }
      },
    );
  };

  const worker = new Worker<P, unknown, string>(queueName, processor, {
    connection: dependencies.connection,
    concurrency: options.concurrency,
    limiter: {
      max: options.rateLimitMax,
      duration: options.rateLimitDuration,
    },
    lockDuration: timeoutMs + 60_000,
    stalledInterval: 30_000,
    maxStalledCount: 1,
  });

  worker.on("stalled", (jobId) => {
    dependencies.logger.warn("job_stalled", { queueName, jobId });
  });

  worker.on("failed", (job) => {
    if (!job) return;
    const parsed = schema.safeParse(job.data);
    if (!parsed.success) return;
    const payload = parsed.data as P;
    const attempts = typeof job.opts.attempts === "number"
      ? job.opts.attempts
      : Number(DEFAULT_JOB_OPTIONS.attempts ?? 5);

    if (job.attemptsMade >= attempts) {
      const safe = toSafeWorkerError({ code: "WORKER_FAILED" });
      trackPendingWorkerSideEffect(
        dependencies.pendingFailureTasks,
        publishDeadLetter(
          dependencies.deadLetterQueue,
          queueName,
          job as Job<WorkerPayload>,
          payload,
          safe.code,
          job.attemptsMade,
        ),
        () => dependencies.logger.error("dead_letter_publish_failed", {
          queueName,
          jobId: job.id ?? null,
          userId: payload.userId,
        }),
      );
      trackPendingWorkerSideEffect(
        dependencies.pendingFailureTasks,
        recordTerminalFailureIfNeeded(
          dependencies.tokenVault,
          queueName,
          payload,
          safe.code,
        ),
        () => dependencies.logger.error("terminal_failure_record_failed", {
          queueName,
          jobId: job.id ?? null,
          userId: payload.userId,
        }),
      );
    }
  });

  worker.on("error", () => {
    dependencies.logger.error("worker_runtime_error", { queueName });
  });

  return worker;
}

export function createWorkerRuntime(input: {
  connection: IORedis;
  tokenVault: UserTokenVault;
  handlers: WorkerHandlers;
  logger?: SafeLogger;
}) {
  const logger = input.logger ?? defaultLogger;
  const deadLetterQueue = new Queue<DeadLetterPayload>(QUEUE_NAMES.deadLetter, {
    connection: input.connection.duplicate(),
    defaultJobOptions: { removeOnComplete: false, removeOnFail: false },
  });

  const pendingFailureTasks = new Set<Promise<void>>();
  const dependencies = {
    connection: input.connection,
    deadLetterQueue,
    tokenVault: input.tokenVault,
    logger,
    pendingFailureTasks,
  };

  const workers = [
    createTypedWorker(
      QUEUE_NAMES.scraper,
      scraperQueuePayloadSchema as ZodType<ScraperQueuePayload>,
      "scraping",
      input.handlers.scrape,
      180_000,
      { concurrency: 3, rateLimitMax: 10, rateLimitDuration: 60_000 },
      dependencies,
    ),
    createTypedWorker(
      QUEUE_NAMES.aiProcessing,
      aiProcessingQueuePayloadSchema as ZodType<AiProcessingQueuePayload>,
      "ai_matching",
      input.handlers.processAi,
      240_000,
      { concurrency: 2, rateLimitMax: 20, rateLimitDuration: 60_000 },
      dependencies,
    ),
    createTypedWorker(
      QUEUE_NAMES.submission,
      submissionQueuePayloadSchema as ZodType<SubmissionQueuePayload>,
      "form_submission",
      input.handlers.submit,
      300_000,
      { concurrency: 1, rateLimitMax: 5, rateLimitDuration: 60_000 },
      dependencies,
    ),
  ];

  return {
    workers,
    deadLetterQueue,
    close: () => closeWorkerResources(
      workers,
      deadLetterQueue,
      input.connection,
      () => drainPendingWorkerSideEffects(pendingFailureTasks),
    ),
  };
}

export async function closeWorkerResources(
  workers: Array<{ close: () => Promise<void> }>,
  deadLetterQueue: { close: () => Promise<void> },
  connection: IORedis,
  drainPending: () => Promise<void> = async () => undefined,
): Promise<void> {
  // Stop fetching/processing first. BullMQ emits terminal "failed" events
  // during this phase, and those listeners register durable side effects.
  const workerResults = await Promise.allSettled(
    workers.map((worker) => worker.close()),
  );

  // Do not close the DLQ queue or Redis connection while stalled-job
  // terminal recording and dead-letter publication are still in flight.
  let drainFailed = false;
  try {
    await drainPending();
  } catch {
    drainFailed = true;
  }

  const deadLetterResults = await Promise.allSettled([deadLetterQueue.close()]);
  let connectionFailed = false;
  if (connection.status !== "end") {
    try {
      await connection.quit();
    } catch {
      connectionFailed = true;
    }
  }

  if (
    drainFailed ||
    connectionFailed ||
    workerResults.some((result) => result.status === "rejected") ||
    deadLetterResults.some((result) => result.status === "rejected")
  ) {
    throw new Error("One or more worker resources did not close cleanly");
  }
}
