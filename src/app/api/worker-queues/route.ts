import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  hasJsonContentType,
  isSameOriginMutation,
  MAX_JSON_BODY_BYTES,
  readRequestTextLimited,
} from "@/lib/http/request-guards";
import { workerQueueRequestSchema } from "@/lib/queues/api-contracts";
import {
  enqueueAiProcessing,
  enqueueScrape,
  enqueueSubmission,
  QueueIngressError,
} from "@/lib/queues/enqueue";
import { createRedisConnection } from "@/lib/queues/connection";
import { closeQueueSet, createQueueSet, type QueueSet } from "@/lib/queues/queues";
import type IORedis from "ioredis";

export const runtime = "nodejs";
export const maxDuration = 15;

function errorResponse(error: unknown): NextResponse {
  if (error instanceof QueueIngressError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "Invalid background task request", code: "INVALID_QUEUE_REQUEST" },
      { status: 422 },
    );
  }
  return NextResponse.json(
    { error: "Background queue is not available", code: "QUEUE_UNAVAILABLE" },
    { status: 503 },
  );
}

/**
 * Authenticated queue ingress for the three BullMQ workers.
 * The browser supplies task identifiers only. userId is derived from the
 * verified Supabase session; vault refs and idempotency keys are server-side.
 */
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Invalid request origin", code: "INVALID_ORIGIN" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ error: "Expected application/json", code: "UNSUPPORTED_MEDIA_TYPE" }, { status: 415 });
  }

  const bodyRead = await readRequestTextLimited(request, MAX_JSON_BODY_BYTES);
  if (!bodyRead.ok) {
    const tooLarge = bodyRead.reason === "too_large";
    return NextResponse.json(
      {
        error: tooLarge ? "Request body too large" : "Invalid request body",
        code: tooLarge ? "BODY_TOO_LARGE" : "INVALID_REQUEST_BODY",
      },
      { status: tooLarge ? 413 : 400 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyRead.text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = workerQueueRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid background task request", code: "INVALID_QUEUE_REQUEST" }, { status: 422 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  let connection: IORedis | undefined;
  let queues: QueueSet | undefined;

  try {
    connection = createRedisConnection();
    queues = createQueueSet(connection);

    const input = parsed.data;
    if (input.queue === "scraper-queue") {
      const job = await enqueueScrape(supabase, queues, {
        userId: authData.user.id,
        source: input.source,
        searchProfileVersion: input.searchProfileVersion,
        runKey: input.runKey,
      });
      return NextResponse.json({
        status: "queued",
        queue: input.queue,
        jobId: job.id ?? null,
        operationId: job.data.operationId,
      }, { status: 202 });
    }

    if (input.queue === "ai-processing-queue") {
      const job = await enqueueAiProcessing(supabase, queues, {
        userId: authData.user.id,
        jobId: input.jobId,
        resumeId: input.resumeId,
        mode: input.mode,
        modelVersion: input.modelVersion ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      });
      return NextResponse.json({
        status: "queued",
        queue: input.queue,
        jobId: job.id ?? null,
        operationId: job.data.operationId,
      }, { status: 202 });
    }

    const job = await enqueueSubmission(supabase, queues, {
      userId: authData.user.id,
      applicationId: input.applicationId,
    });
    return NextResponse.json({
      status: "queued",
      queue: input.queue,
      jobId: job.id ?? null,
      operationId: job.data.operationId,
    }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  } finally {
    if (queues) {
      await closeQueueSet(queues).catch(() => {
        // Do not turn an accepted queue write into a misleading client failure.
        console.error("worker_queue_ingress_cleanup_failed");
      });
    } else if (connection && connection.status !== "end") {
      await connection.quit().catch(() => {
        console.error("worker_queue_connection_cleanup_failed");
      });
    }
  }
}
