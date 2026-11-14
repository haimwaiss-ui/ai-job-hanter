import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { workerJobSchema, type WorkerJobInput } from "@/lib/validation/job-hunter";

export function parseWorkerPayload(input: unknown): WorkerJobInput {
  const result = workerJobSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid worker payload: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Call this before processing any job. Then use a user-scoped Supabase client
 * whose access token was resolved from tokenVaultRef. The authenticated user
 * must match payload.userId; RLS is still the final database enforcement.
 */
export async function assertWorkerTenant(
  supabase: SupabaseClient<Database>,
  expectedUserId: string,
) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || data.user.id !== expectedUserId) {
    throw new Error("Worker tenant identity mismatch");
  }
}
