import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ExecutionStatus, ExecutionType, Json } from "@/lib/supabase/database.types";

export interface SafeWorkerError {
  code: string;
  message: string;
}

export function toSafeWorkerError(error: unknown): SafeWorkerError {
  const candidate = error as { code?: unknown } | null;
  const code = typeof candidate?.code === "string" && /^[A-Z0-9_]{2,64}$/.test(candidate.code)
    ? candidate.code
    : "WORKER_FAILED";

  if (code === "WORKER_TIMEOUT") {
    return { code, message: "Background operation exceeded its time limit." };
  }
  if (code === "CAPTCHA_DETECTED" || code === "SITE_BLOCKED" || code === "AUTH_REQUIRED") {
    return { code, message: "Automated submission paused; human assistance is required." };
  }
  return { code, message: "Background operation failed. A retry or manual review may follow." };
}

export async function writeExecutionLog(
  supabase: SupabaseClient<Database>,
  input: {
    userId: string;
    executionType: ExecutionType;
    status: ExecutionStatus;
    operation: string;
    attemptNumber: number;
    durationMs?: number;
    jobId?: string | null;
    applicationId?: string | null;
    error?: SafeWorkerError;
    fallbackReason?: string | null;
    metadata?: Json;
  },
): Promise<void> {
  const { error } = await supabase.from("execution_logs").insert({
    user_id: input.userId,
    job_id: input.jobId ?? null,
    application_id: input.applicationId ?? null,
    execution_type: input.executionType,
    status: input.status,
    service_name: "bullmq-worker",
    operation: input.operation,
    attempt_number: input.attemptNumber,
    duration_ms: input.durationMs ?? null,
    error_code: input.error?.code ?? null,
    error_message: input.error?.message ?? null,
    fallback_reason: input.fallbackReason ?? null,
    metadata: input.metadata ?? {},
  });

  if (error) throw new Error("Tenant-scoped execution log write failed");
}
