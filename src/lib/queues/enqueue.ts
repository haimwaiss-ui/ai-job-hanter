import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type {
  AiProcessingQueuePayload,
  ScraperQueuePayload,
  SubmissionQueuePayload,
} from "./contracts";
import {
  aiProcessingQueuePayloadSchema,
  scraperQueuePayloadSchema,
  submissionQueuePayloadSchema,
} from "./contracts";
import type { QueueSet } from "./queues";
import { QUEUE_NAMES } from "./queues";
import { createBullJobId, createIdempotencyKey } from "@/lib/workers/idempotency";

type DbClient = SupabaseClient<Database>;

export class QueueIngressError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "QueueIngressError";
  }
}

async function requireTenantAndVaultRef(
  supabase: DbClient,
  expectedUserId: string,
): Promise<string> {
  if (!z.string().uuid().safeParse(expectedUserId).success) {
    throw new QueueIngressError("UNAUTHORIZED", 401, "Authenticated user is required");
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user || authData.user.id !== expectedUserId) {
    throw new QueueIngressError("TENANT_MISMATCH", 403, "Authenticated tenant mismatch");
  }

  // A pending row is not enough: provisioning is complete only after the
  // dedicated Auth session and rotated tokens have been verified in the vault.
  const { data, error } = await supabase
    .from("worker_sessions")
    .select("token_vault_ref")
    .eq("user_id", expectedUserId)
    .is("revoked_at", null)
    .not("provisioned_at", "is", null)
    .single();

  if (error || !data?.token_vault_ref) {
    throw new QueueIngressError(
      "WORKER_SESSION_NOT_PROVISIONED",
      409,
      "Background processing is not connected for this account",
    );
  }
  if (!z.string().uuid().safeParse(data.token_vault_ref).success) {
    throw new QueueIngressError("WORKER_SESSION_INVALID", 409, "Background worker registration is invalid");
  }
  return data.token_vault_ref;
}

export async function enqueueScrape(
  supabase: DbClient,
  queues: QueueSet,
  input: {
    userId: string;
    source: ScraperQueuePayload["source"];
    searchProfileVersion: number;
    runKey: string;
  },
) {
  const tokenVaultRef = await requireTenantAndVaultRef(supabase, input.userId);
  const key = createIdempotencyKey(
    QUEUE_NAMES.scraper,
    input.userId,
    "run:" + input.runKey + ":" + input.source + ":" + input.searchProfileVersion,
  );
  const payload = scraperQueuePayloadSchema.parse({
    ...input,
    operationId: randomUUID(),
    tokenVaultRef,
    idempotencyKey: key,
  }) satisfies ScraperQueuePayload;

  return queues.scraper.add("scrape", payload, {
    jobId: createBullJobId(QUEUE_NAMES.scraper, key),
  });
}

export async function enqueueAiProcessing(
  supabase: DbClient,
  queues: QueueSet,
  input: {
    userId: string;
    jobId: string;
    resumeId: string;
    mode: AiProcessingQueuePayload["mode"];
    modelVersion: string;
  },
) {
  const tokenVaultRef = await requireTenantAndVaultRef(supabase, input.userId);

  const [jobResult, resumeResult] = await Promise.all([
    supabase.from("jobs")
      .select("id")
      .eq("id", input.jobId)
      .eq("user_id", input.userId)
      .maybeSingle(),
    supabase.from("resumes")
      .select("id")
      .eq("id", input.resumeId)
      .eq("user_id", input.userId)
      .maybeSingle(),
  ]);

  if (jobResult.error || resumeResult.error) {
    throw new QueueIngressError("TENANT_RESOURCE_LOOKUP_FAILED", 500, "Unable to verify job and resume ownership");
  }
  if (!jobResult.data) {
    throw new QueueIngressError("JOB_NOT_FOUND", 404, "Job not found for authenticated tenant");
  }
  if (!resumeResult.data) {
    throw new QueueIngressError("RESUME_NOT_FOUND", 404, "Resume not found for authenticated tenant");
  }

  const key = createIdempotencyKey(
    QUEUE_NAMES.aiProcessing,
    input.userId,
    "job:" + input.jobId + ":resume:" + input.resumeId + ":" + input.mode + ":" + input.modelVersion,
  );
  const payload = aiProcessingQueuePayloadSchema.parse({
    ...input,
    operationId: randomUUID(),
    tokenVaultRef,
    idempotencyKey: key,
  }) satisfies AiProcessingQueuePayload;

  return queues.aiProcessing.add("process-ai", payload, {
    jobId: createBullJobId(QUEUE_NAMES.aiProcessing, key),
  });
}

export async function enqueueSubmission(
  supabase: DbClient,
  queues: QueueSet,
  input: { userId: string; applicationId: string },
) {
  const tokenVaultRef = await requireTenantAndVaultRef(supabase, input.userId);

  const { data: application, error } = await supabase
    .from("applications")
    .select("id,status")
    .eq("id", input.applicationId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (error) {
    throw new QueueIngressError("APPLICATION_LOOKUP_FAILED", 500, "Unable to verify application ownership");
  }
  if (!application) {
    throw new QueueIngressError("APPLICATION_NOT_FOUND", 404, "Application not found for authenticated tenant");
  }
  if (application.status !== "approved" && application.status !== "ready_to_submit") {
    throw new QueueIngressError("APPLICATION_NOT_APPROVED", 409, "Application is not approved for submission");
  }

  const key = createIdempotencyKey(
    QUEUE_NAMES.submission,
    input.userId,
    "application:" + input.applicationId + ":submit:v1",
  );
  const payload = submissionQueuePayloadSchema.parse({
    userId: input.userId,
    applicationId: input.applicationId,
    operationId: randomUUID(),
    tokenVaultRef,
    idempotencyKey: key,
  }) satisfies SubmissionQueuePayload;

  return queues.submission.add("submit", payload, {
    jobId: createBullJobId(QUEUE_NAMES.submission, key),
  });
}
