import { loadEnvConfig } from "@next/env";
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Tables } from "../src/lib/supabase/database.types";
import { extractAuthSessionId, extractWorkerSessionClaims } from "../src/lib/workers/token-vault";

loadEnvConfig(process.cwd());

const envSchema = z.object({
  SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(20).optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(40),
  AWS_REGION: z.string().min(1),
  TOKEN_VAULT_SECRET_PREFIX: z.string().trim().min(1),
  WORKER_USER_ID: z.string().uuid(),
}).superRefine((value, ctx) => {
  if (!value.SUPABASE_URL && !value.NEXT_PUBLIC_SUPABASE_URL) {
    ctx.addIssue({ code: "custom", path: ["SUPABASE_URL"], message: "Supabase URL is required" });
  }
  if (!value.SUPABASE_ANON_KEY && !value.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    ctx.addIssue({ code: "custom", path: ["SUPABASE_ANON_KEY"], message: "Supabase anon key is required" });
  }
}).parse(process.env);

const supabaseUrl = envSchema.SUPABASE_URL ?? envSchema.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = envSchema.SUPABASE_ANON_KEY ?? envSchema.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const userId = envSchema.WORKER_USER_ID;
const secretPrefix = envSchema.TOKEN_VAULT_SECRET_PREFIX.replace(/\/+$/, "");
const now = () => new Date().toISOString();

const vaultSessionSchema = z.object({
  userId: z.string().uuid(),
  sessionId: z.string().uuid(),
  accessToken: z.string().min(40),
  refreshToken: z.string().min(40),
  expiresAt: z.number().int().positive(),
}).strict();

type WorkerSessionRow = Tables<"worker_sessions">;

function secretId(tokenVaultRef: string): string {
  return secretPrefix + "/" + userId + "/" + tokenVaultRef;
}

async function deleteSecretIfPresent(secrets: SecretsManagerClient, id: string): Promise<void> {
  try {
    await secrets.send(new DeleteSecretCommand({
      SecretId: id,
      ForceDeleteWithoutRecovery: true,
    }));
  } catch (error) {
    if ((error as { name?: string }).name !== "ResourceNotFoundException") throw error;
  }
}

async function existingSecretIsValid(
  secrets: SecretsManagerClient,
  existing: WorkerSessionRow,
): Promise<boolean> {
  if (existing.revoked_at || !existing.provisioned_at) return false;
  try {
    const result = await secrets.send(new GetSecretValueCommand({
      SecretId: secretId(existing.token_vault_ref),
    }));
    if (!result.SecretString) return false;
    const parsed = vaultSessionSchema.safeParse(JSON.parse(result.SecretString));
    if (!parsed.success || parsed.data.userId !== userId ||
        parsed.data.sessionId !== existing.auth_session_id ||
        extractAuthSessionId(parsed.data.accessToken) !== existing.auth_session_id) {
      return false;
    }
    const claims = extractWorkerSessionClaims(parsed.data.accessToken);
    return claims.userId === userId && claims.sessionId === existing.auth_session_id && claims.worker;
  } catch (error) {
    if ((error as { name?: string }).name === "ResourceNotFoundException") return false;
    throw new Error("Unable to inspect the existing worker token vault entry");
  }
}

async function main(): Promise<void> {
  const serviceClient = createClient<Database>(
    supabaseUrl,
    envSchema.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const authClient = createClient<Database>(
    supabaseUrl,
    anonKey,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const secrets = new SecretsManagerClient({ region: envSchema.AWS_REGION });
  const lockToken = randomUUID();
  let lockAcquired = false;

  try {
    const { data: acquired, error: lockError } = await serviceClient.rpc(
      "acquire_worker_provisioning_lock",
      { p_user_id: userId, p_lock_token: lockToken, p_lease_seconds: 300 },
    );
    if (lockError || acquired !== true) throw new Error("Unable to acquire the worker provisioning lock");
    lockAcquired = true;

    const { data: previous, error: readError } = await serviceClient
      .from("worker_sessions")
      .select("user_id,token_vault_ref,auth_session_id,revoked_at,created_at,updated_at,provisioned_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (readError) throw new Error("Unable to read existing worker registration");

    if (previous && await existingSecretIsValid(secrets, previous)) {
      console.info(JSON.stringify({ event: "worker_session_already_provisioned", userId }));
      return;
    }

    const { data: userResult, error: userError } = await serviceClient.auth.admin.getUserById(userId);
    const email = userResult.user?.email;
    if (userError || !email || !userResult.user?.email_confirmed_at) {
      throw new Error("A verified email account is required for worker provisioning");
    }

    // Admin generateLink returns a one-time token without sending an email.
    // Exchanging it creates a separate Auth session; browser tokens are never reused.
    const { data: link, error: linkError } = await serviceClient.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const tokenHash = z.string().min(20).safeParse(link?.properties?.hashed_token);
    if (linkError || !tokenHash.success) throw new Error("Unable to create a dedicated worker Auth session");

    const { data: verified, error: verifyError } = await authClient.auth.verifyOtp({
      token_hash: tokenHash.data,
      type: "magiclink",
    });
    if (verifyError || !verified.session || verified.user?.id !== userId) {
      throw new Error("Unable to exchange the worker sign-in token");
    }

    const initialSessionId = extractAuthSessionId(verified.session.access_token);
    const tokenVaultRef = randomUUID();
    const newSecretId = secretId(tokenVaultRef);
    let registrationChanged = false;
    let secretCreated = false;

    try {
      const { error: registerError } = await serviceClient.from("worker_sessions").upsert({
        user_id: userId,
        token_vault_ref: tokenVaultRef,
        auth_session_id: initialSessionId,
        revoked_at: null,
        provisioned_at: null,
        updated_at: now(),
      }, { onConflict: "user_id" });
      if (registerError) throw new Error("Unable to register the dedicated worker session");
      registrationChanged = true;

      // The Auth hook sees the row on refresh and adds the worker claim.
      const { data: refreshed, error: refreshError } = await authClient.auth.refreshSession({
        refresh_token: verified.session.refresh_token,
      });
      if (refreshError || !refreshed.session || refreshed.user?.id !== userId) {
        throw new Error("Unable to refresh the dedicated worker Auth session");
      }

      const claims = extractWorkerSessionClaims(refreshed.session.access_token);
      const sessionId = claims.sessionId;
      if (claims.userId !== userId || !claims.worker || sessionId !== initialSessionId) {
        throw new Error("The Supabase Custom Access Token Hook is not enabled or did not issue the worker claim");
      }

      const vaultSession = vaultSessionSchema.parse({
        userId,
        sessionId,
        accessToken: refreshed.session.access_token,
        refreshToken: refreshed.session.refresh_token,
        expiresAt: (refreshed.session.expires_at ??
          Math.floor(Date.now() / 1000) + refreshed.session.expires_in) * 1000,
      });

      await secrets.send(new CreateSecretCommand({
        Name: newSecretId,
        SecretString: JSON.stringify(vaultSession),
        ...(process.env.TOKEN_VAULT_KMS_KEY_ID ? { KmsKeyId: process.env.TOKEN_VAULT_KMS_KEY_ID } : {}),
      }));
      secretCreated = true;

      const { error: provisionError } = await serviceClient
        .from("worker_sessions")
        .update({ provisioned_at: now(), updated_at: now() })
        .eq("user_id", userId)
        .eq("token_vault_ref", tokenVaultRef)
        .eq("auth_session_id", sessionId);
      if (provisionError) throw new Error("Unable to mark the worker session as provisioned");

      const workerClient = createClient<Database>(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: "Bearer " + vaultSession.accessToken } },
      });
      const { data: workerUser, error: workerAuthError } = await workerClient.auth.getUser(vaultSession.accessToken);
      const { data: context, error: contextError } = await workerClient.rpc("worker_current_context");
      const workerContext = Array.isArray(context) ? context[0] : undefined;
      if (workerAuthError || workerUser.user?.id !== userId ||
          contextError || workerContext?.user_id !== userId || workerContext.worker_enabled !== true) {
        throw new Error("The provisioned worker session failed its tenant verification");
      }

      if (previous) {
        try { await deleteSecretIfPresent(secrets, secretId(previous.token_vault_ref)); } catch {
          console.warn(JSON.stringify({ event: "old_worker_secret_cleanup_pending", userId }));
        }
      }

      console.info(JSON.stringify({ event: "worker_session_provisioned", userId }));
    } catch (error) {
      if (secretCreated) {
        try { await deleteSecretIfPresent(secrets, newSecretId); } catch {
          console.warn(JSON.stringify({ event: "worker_secret_cleanup_pending", userId }));
        }
      }
      if (registrationChanged) {
        if (previous) {
          const { error: restoreError } = await serviceClient
            .from("worker_sessions")
            .upsert(previous, { onConflict: "user_id" });
          if (restoreError) {
            console.error(JSON.stringify({ event: "worker_registration_rollback_failed", userId }));
          }
        } else {
          const { error: cleanupError } = await serviceClient.from("worker_sessions").delete()
            .eq("user_id", userId)
            .eq("auth_session_id", initialSessionId);
          if (cleanupError) {
            console.error(JSON.stringify({ event: "worker_registration_cleanup_failed", userId }));
          }
        }
      }
      throw error;
    }
  } finally {
    if (lockAcquired) {
      const { error: releaseError } = await serviceClient.rpc(
        "release_worker_provisioning_lock",
        { p_user_id: userId, p_lock_token: lockToken },
      );
      if (releaseError) console.warn(JSON.stringify({ event: "worker_provisioning_lock_release_failed", userId }));
    }
  }
}

main().catch(() => {
  console.error(JSON.stringify({ event: "worker_session_provision_failed", errorCode: "WORKER_SESSION_PROVISION_FAILED" }));
  process.exitCode = 1;
});
