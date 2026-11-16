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
import {
  contentLengthExceeds,
  hasJsonContentType,
  isSameOriginMutation,
  MAX_JSON_BODY_BYTES,
  readJsonBodyLimited,
} from "@/lib/http/request-guards";

export const runtime = "nodejs";

/**
 * Queue ingress uses the caller's ordinary authenticated session. It never
 * creates or mutates worker_sessions; that table is provisioned only by a
 * separate trusted control-plane process.
 */
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
  }
  if (contentLengthExceeds(request, MAX_JSON_BODY_BYTES)) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }

  const body = await readJsonBodyLimited(request, MAX_JSON_BODY_BYTES);
  if (!body.ok) {
    return NextResponse.json(
      { error: body.reason === "too_large" ? "Request body too large" : "Invalid JSON body" },
      { status: body.reason === "too_large" ? 413 : 400 },
    );
  }

  const parsed = enqueueQueueRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid queue request", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = authData.user.id;
  const { data: workerSession, error: workerSessionError } = await supabase
    .from("worker_sessions")
    .select("token_vault_ref,revoked_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (workerSessionError) {
    return NextResponse.json({ error: "Worker session status is unavailable" }, { status: 503 });
  }
  if (!workerSession || workerSession.revoked_at) {
    return NextResponse.json({ error: "Background processing is not enabled for this account" }, { status: 409 });
  }

  let queueSet: ReturnType<typeof createQueueSet> | undefined;
  let jobId: string | undefined;

  try {
    const operationId = randomUUID();

    switch (parsed.data.queue) {
      case "scraper-queue": {
        const input = parsed.data.payload;
        const idempotencyKey = createIdempotencyKey("scraper-queue", userId, input.runKey);
        const payload = scraperQueuePayloadSchema.parse({
          ...input,
          userId,
          operationId,
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

        const idempotencyKey = createIdempotencyKey(
          "ai-processing-queue",
          userId,
          [input.jobId, input.resumeId, input.mode, input.modelVersion].join(":"),
        );
        const payload = aiProcessingQueuePayloadSchema.parse({
          ...input,
          userId,
          operationId,
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

        const idempotencyKey = createIdempotencyKey(
          "submission-queue",
          userId,
          input.applicationId + ":submit:v1",
        );
        const payload = submissionQueuePayloadSchema.parse({
          ...input,
          userId,
          operationId,
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

    if (!jobId) {
      return NextResponse.json({ error: "Background queue did not accept the request" }, { status: 503 });
    }

    return NextResponse.json(
      { queue: parsed.data.queue, jobId, status: "queued" },
      { status: 202 },
    );
  } catch {
    // Do not return Redis or SDK errors: they can contain internal connection details.
    return NextResponse.json({ error: "Background queue is temporarily unavailable" }, { status: 503 });
  } finally {
    if (queueSet) {
      await closeQueueSet(queueSet).catch(() => undefined);
    }
  }
}
