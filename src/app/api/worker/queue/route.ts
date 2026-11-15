import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  aiProcessingQueuePayloadSchema,
  scraperQueuePayloadSchema,
  submissionQueuePayloadSchema,
} from "@/lib/queues/contracts";
import { enqueueQueueRequestSchema } from "@/lib/queues/api-schemas";
import { createBullJobId, createIdempotencyKey } from "@/lib/queues/producer";
import { closeQueueSet, createQueueSet } from "@/lib/queues/queues";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = enqueueQueueRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid queue request", details: parsed.error.flatten() }, { status: 422 });
  }

  const userId = authData.user.id;
  const { data: workerSession, error: workerSessionError } = await supabase
    .from("worker_sessions")
    .select("token_vault_ref,revoked_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (workerSessionError) {
    return NextResponse.json({ error: "Worker database migration is not installed" }, { status: 503 });
  }
  if (!workerSession || workerSession.revoked_at) {
    return NextResponse.json({ error: "Register worker access before enqueueing jobs" }, { status: 409 });
  }

  const { data: contextData, error: contextError } = await supabase.rpc("worker_current_context");
  const context = Array.isArray(contextData) ? contextData[0] : undefined;
  if (
    contextError ||
    !context ||
    context.user_id !== userId ||
    context.worker_enabled !== true ||
    context.token_vault_ref !== workerSession.token_vault_ref
  ) {
    return NextResponse.json({ error: "Worker session is not active" }, { status: 409 });
  }

  let queueSet: ReturnType<typeof createQueueSet> | undefined;
  try {
    const operationId = randomUUID();
    let queueName: "scraper-queue" | "ai-processing-queue" | "submission-queue";
    let idempotencyKey: string;
    let jobId: string;

    switch (parsed.data.queue) {
      case "scraper-queue": {
        const input = parsed.data.payload;
        queueName = "scraper-queue";
        idempotencyKey = createIdempotencyKey(queueName, userId, input.runKey);
        const payload = scraperQueuePayloadSchema.parse({
          ...input, userId, operationId,
          tokenVaultRef: workerSession.token_vault_ref,
          idempotencyKey,
        });
        queueSet = createQueueSet();
        const job = await queueSet.scraper.add("scrape", payload, {
          jobId: createBullJobId(idempotencyKey),
        });
        jobId = job.id ?? createBullJobId(idempotencyKey);
        break;
      }
      case "ai-processing-queue": {
        const input = parsed.data.payload;
        const [jobResult, resumeResult] = await Promise.all([
          supabase.from("jobs").select("id").eq("id", input.jobId).eq("user_id", userId).maybeSingle(),
          supabase.from("resumes").select("id").eq("id", input.resumeId).eq("user_id", userId).maybeSingle(),
        ]);
        if (jobResult.error || resumeResult.error) {
          return NextResponse.json({ error: "Unable to verify tenant-owned job and resume" }, { status: 503 });
        }
        if (!jobResult.data || !resumeResult.data) {
          return NextResponse.json({ error: "Job or resume was not found for this account" }, { status: 404 });
        }

        queueName = "ai-processing-queue";
        idempotencyKey = createIdempotencyKey(
          queueName,
          userId,
          [input.jobId, input.resumeId, input.mode, input.modelVersion].join(":"),
        );
        const payload = aiProcessingQueuePayloadSchema.parse({
          ...input, userId, operationId,
          tokenVaultRef: workerSession.token_vault_ref,
          idempotencyKey,
        });
        queueSet = createQueueSet();
        const job = await queueSet.aiProcessing.add("process-ai", payload, {
          jobId: createBullJobId(idempotencyKey),
        });
        jobId = job.id ?? createBullJobId(idempotencyKey);
        break;
      }
      case "submission-queue": {
        const input = parsed.data.payload;
        const { data: application, error: applicationError } = await supabase
          .from("applications")
          .select("id,status,manual_assist_required")
          .eq("id", input.applicationId)
          .eq("user_id", userId)
          .maybeSingle();

        if (applicationError) {
          return NextResponse.json({ error: "Unable to verify application ownership" }, { status: 503 });
        }
        if (!application) {
          return NextResponse.json({ error: "Application was not found for this account" }, { status: 404 });
        }
        if (
          application.manual_assist_required ||
          !["approved", "ready_to_submit"].includes(application.status)
        ) {
          return NextResponse.json({
            error: "Submission requires explicit approval and an application ready to submit",
          }, { status: 409 });
        }

        queueName = "submission-queue";
        idempotencyKey = createIdempotencyKey(queueName, userId, input.applicationId + ":submit:v1");
        const payload = submissionQueuePayloadSchema.parse({
          ...input, userId, operationId,
          tokenVaultRef: workerSession.token_vault_ref,
          idempotencyKey,
        });
        queueSet = createQueueSet();
        const job = await queueSet.submission.add("submit", payload, {
          jobId: createBullJobId(idempotencyKey),
        });
        jobId = job.id ?? createBullJobId(idempotencyKey);
        break;
      }
    }

    return NextResponse.json({ queue: parsed.data.queue, jobId, status: "queued" }, { status: 202 });
  } catch {
    // Redis/SDK errors are deliberately not returned to the caller.
    return NextResponse.json({ error: "Background queue is temporarily unavailable" }, { status: 503 });
  } finally {
    if (queueSet) await closeQueueSet(queueSet);
  }
}
