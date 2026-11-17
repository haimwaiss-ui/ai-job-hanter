import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type {
  AiProcessingQueuePayload,
  ScraperQueuePayload,
  SubmissionQueuePayload,
} from "./contracts";
import type { QueueSet } from "./queues";
import { QUEUE_NAMES } from "./queues";
import { createBullJobId, createIdempotencyKey } from "@/lib/queues/producer";

type DbClient = SupabaseClient<Database>;

async function requireTenantAndVaultRef(
  supabase: DbClient,
  expectedUserId: string,
): Promise<string> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user || authData.user.id !== expectedUserId) {
    throw new Error("Authenticated tenant mismatch");
  }

  const { data, error } = await supabase
    .from("worker_sessions")
    .select("token_vault_ref")
    .eq("user_id", expectedUserId)
    .is("revoked_at", null)
    .single();

  if (error || !data?.token_vault_ref) {
    throw new Error("Background worker session is not connected");
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
  const payload = {
    ...input,
    operationId: randomUUID(),
    tokenVaultRef,
    idempotencyKey: key,
  } satisfies ScraperQueuePayload;

  return queues.scraper.add("scrape", payload, {
    jobId: createBullJobId(key),
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
  const key = createIdempotencyKey(
    QUEUE_NAMES.aiProcessing,
    input.userId,
    "job:" + input.jobId + ":resume:" + input.resumeId + ":" + input.mode + ":" + input.modelVersion,
  );
  const payload = {
    ...input,
    operationId: randomUUID(),
    tokenVaultRef,
    idempotencyKey: key,
  } satisfies AiProcessingQueuePayload;

  return queues.aiProcessing.add("process-ai", payload, {
    jobId: createBullJobId(key),
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
    .single();

  if (error || !application) {
    throw new Error("Application not found for authenticated tenant");
  }
  if (application.status !== "approved" && application.status !== "ready_to_submit") {
    throw new Error("Application is not approved for submission");
  }

  const key = createIdempotencyKey(
    QUEUE_NAMES.submission,
    input.userId,
    "application:" + input.applicationId + ":submit:v1",
  );
  const payload = {
    userId: input.userId,
    applicationId: input.applicationId,
    operationId: randomUUID(),
    tokenVaultRef,
    idempotencyKey: key,
  } satisfies SubmissionQueuePayload;

  return queues.submission.add("submit", payload, {
    jobId: createBullJobId(key),
  });
}
