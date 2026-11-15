import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AwsSecretsManagerTokenVault } from "@/lib/workers/token-vault";

export const runtime = "nodejs";

/**
 * Store the current user's session in AWS Secrets Manager, then register only
 * the opaque vault reference in Supabase. The worker later resolves a short-
 * lived user JWT and continues to use normal RLS; no service-role client exists.
 */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (sessionError || !session || session.user.id !== authData.user.id) {
    return NextResponse.json({ error: "A valid sign-in session is required" }, { status: 401 });
  }

  try {
    const vault = new AwsSecretsManagerTokenVault(undefined);
    const tokenVaultRef = randomUUID();

    await vault.storeSession(authData.user.id, session, tokenVaultRef);

    const { error: registrationError } = await supabase
      .from("worker_sessions")
      .upsert({
        user_id: authData.user.id,
        token_vault_ref: tokenVaultRef,
        revoked_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

    if (registrationError) {
      return NextResponse.json({ error: "Worker session registration is unavailable" }, { status: 503 });
    }

    // Refresh after registration so the Custom Access Token Hook can bind the
    // worker claim to this exact vault reference.
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession({
      refresh_token: session.refresh_token,
    });

    if (refreshError || !refreshed.session || refreshed.user?.id !== authData.user.id) {
      await supabase.from("worker_sessions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_id", authData.user.id);
      return NextResponse.json({ error: "Worker session refresh failed" }, { status: 503 });
    }

    await vault.updateSession(authData.user.id, tokenVaultRef, refreshed.session);

    const { data: contextData, error: contextError } = await supabase.rpc("worker_current_context");
    const context = Array.isArray(contextData) ? contextData[0] : undefined;

    if (contextError) {
      return NextResponse.json({ error: "Worker database migration is not installed" }, { status: 503 });
    }
    if (
      !context ||
      context.user_id !== authData.user.id ||
      context.worker_enabled !== true ||
      context.token_vault_ref !== tokenVaultRef
    ) {
      return NextResponse.json({
        error: "Enable the Supabase Custom Access Token Hook and retry worker registration",
        code: "WORKER_AUTH_HOOK_NOT_ENABLED",
      }, { status: 409 });
    }

    return NextResponse.json({ workerEnabled: true });
  } catch {
    // Never serialize SDK errors: they may contain request details or secrets.
    return NextResponse.json({ error: "Secure worker credential storage is unavailable" }, { status: 503 });
  }
}

/** Revocation is immediate at the database/RLS boundary, even before JWT expiry. */
export async function DELETE() {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("worker_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", authData.user.id);

  if (error) {
    return NextResponse.json({ error: "Unable to revoke worker access" }, { status: 503 });
  }

  return NextResponse.json({ workerEnabled: false });
}
