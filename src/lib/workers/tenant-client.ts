import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Workers must obtain a short-lived user access token from a secure token
 * vault using tokenVaultRef. Never put raw access/refresh tokens in BullMQ
 * payloads, logs, job names, or metrics.
 *
 * This client uses the public key plus the user's JWT, so auth.uid() and RLS
 * continue to apply. Do not replace this with service_role.
 */
export function createTenantWorkerClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase environment is incomplete");
  if (!accessToken || accessToken.length < 40) throw new Error("Invalid user token");

  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
