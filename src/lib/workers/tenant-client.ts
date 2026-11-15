import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Workers authenticate with a short-lived user JWT resolved from the
 * server-side token vault. The publishable key is not privileged; RLS remains
 * the database authorization boundary.
 */
export function createTenantWorkerClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase worker environment is incomplete");
  if (!accessToken || accessToken.length < 40) throw new Error("Invalid worker access token");

  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: "Bearer " + accessToken } },
  });
}

/**
 * Verify the token with Supabase Auth, then ask Postgres to evaluate auth.uid()
 * and the custom worker claim in the actual database request context.
 */
export async function assertWorkerTenant(
  supabase: SupabaseClient<Database>,
  expectedUserId: string,
  expectedTokenVaultRef: string,
): Promise<void> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user || authData.user.id !== expectedUserId) {
    throw new Error("Worker tenant identity mismatch");
  }

  const { data, error } = await supabase.rpc("worker_current_context");
  const context = Array.isArray(data) ? data[0] : undefined;
  if (
    error ||
    !context ||
    context.user_id !== expectedUserId ||
    context.worker_enabled !== true ||
    context.token_vault_ref !== expectedTokenVaultRef
  ) {
    throw new Error("Worker JWT claim or database tenant context is invalid");
  }
}
