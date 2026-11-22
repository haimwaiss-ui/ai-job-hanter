import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { enqueueQueueRequestSchema } from "@/lib/queues/api-schemas";
import { enqueueAiProcessing, enqueueScrape, enqueueSubmission } from "@/lib/queues/enqueue";
import { closeQueueSet, createQueueSet } from "@/lib/queues/queues";
import {
  contentLengthExceeds,
  hasJsonContentType,
  isSameOriginMutation,
  MAX_JSON_BODY_BYTES,
  readJsonBodyLimited,
} from "@/lib/http/request-guards";

export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * Authenticated queue ingress. The caller supplies task inputs only; tenant
 * identity, worker-vault reference, operation ID and idempotency key are
 * derived server-side. Tenant records are checked with the user's JWT/RLS.
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
    return NextResponse.json({ error: "Invalid queue request" }, { status: 422 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authData.user.id;

  // Queue ingress stays closed until the separate worker Auth session has
  // been fully provisioned and its token has been stored in Secrets Manager.
  const { data: workerSession, error: workerSessionError } = await supabase
    .from("worker_sessions")
    .select("provisioned_at,revoked_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (workerSessionError) {
    return NextResponse.json({ error: "Worker session status is unavailable" }, { status: 503 });
  }
  if (!workerSession || workerSession.revoked_at || !workerSession.provisioned_at) {
    return NextResponse.json({ error: "Background processing is not enabled for this account" }, { status: 409 });
  }

  let queues: ReturnType<typeof createQueueSet> | undefined;
  try {
    queues = createQueueSet();
    let jobId: string | undefined;

    switch (parsed.data.queue) {
      case "scraper-queue": {
        const job = await enqueueScrape(supabase, queues, {
          userId,
          ...parsed.data.payload,
        });
        jobId = job.id;
        break;
      }

      case "ai-processing-queue": {
        const input = parsed.data.payload;
        const [jobResult, resumeResult] = await Promise.all([
          supabase.from("jobs").select("id").eq("id", input.jobId).eq("user_id", userId).maybeSingle(),
          supabase.from("resumes").select("id").eq("id", input.resumeId).eq("user_id", userId).maybeSingle(),
        ]);

        if (jobResult.error || resumeResult.error) {
          return NextResponse.json({ error: "Unable to verify job and resume ownership" }, { status: 503 });
        }
        if (!jobResult.data || !resumeResult.data) {
          return NextResponse.json({ error: "Job or resume was not found for this account" }, { status: 404 });
        }

        const job = await enqueueAiProcessing(supabase, queues, {
          userId,
          ...input,
        });
        jobId = job.id;
        break;
      }

      case "submission-queue": {
        const { data: application, error } = await supabase
          .from("applications")
          .select("id,status,manual_assist_required")
          .eq("id", parsed.data.payload.applicationId)
          .eq("user_id", userId)
          .maybeSingle();

        if (error) {
          return NextResponse.json({ error: "Unable to verify application ownership" }, { status: 503 });
        }
        if (!application) {
          return NextResponse.json({ error: "Application was not found for this account" }, { status: 404 });
        }
        if (application.manual_assist_required ||
            !["approved", "ready_to_submit"].includes(application.status)) {
          return NextResponse.json({
            error: "Submission requires explicit approval and an application ready to submit",
          }, { status: 409 });
        }

        const job = await enqueueSubmission(supabase, queues, {
          userId,
          applicationId: parsed.data.payload.applicationId,
        });
        jobId = job.id;
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
    // Do not expose Redis, AWS, or Supabase SDK details to the browser.
    return NextResponse.json({ error: "Background queue is temporarily unavailable" }, { status: 503 });
  } finally {
    if (queues) {
      await closeQueueSet(queues).catch(() => undefined);
    }
  }
}
