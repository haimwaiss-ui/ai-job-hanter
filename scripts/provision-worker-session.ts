import {
  CreateSecretCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  AWS_REGION: z.string().min(1),
  TOKEN_VAULT_SECRET_PREFIX: z.string().min(1),
  WORKER_USER_ID: z.string().uuid(),
  WORKER_ACCESS_TOKEN: z.string().min(40),
  WORKER_REFRESH_TOKEN: z.string().min(40),
}).parse(process.env);

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  if (!part) throw new Error("Invalid JWT format");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const supabase = createClient(
    envSchema.NEXT_PUBLIC_SUPABASE_URL,
    envSchema.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: "Bearer " + envSchema.WORKER_ACCESS_TOKEN } },
    },
  );

  const { data: authData, error: authError } = await supabase.auth.getUser(envSchema.WORKER_ACCESS_TOKEN);
  if (authError || !authData.user || authData.user.id !== envSchema.WORKER_USER_ID) {
    throw new Error("Worker token does not match the requested user");
  }

  const { data: existing } = await supabase
    .from("worker_sessions")
    .select("token_vault_ref")
    .eq("user_id", envSchema.WORKER_USER_ID)
    .maybeSingle();

  const tokenVaultRef = existing?.token_vault_ref ?? randomUUID();
  const { error: registerError } = await supabase
    .from("worker_sessions")
    .upsert({
      user_id: envSchema.WORKER_USER_ID,
      token_vault_ref: tokenVaultRef,
      revoked_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

  if (registerError) throw new Error("Unable to register worker session");

  // Refresh after registering so the Custom Access Token Hook can add the
  // worker claim to this dedicated session. Never use the browser's live
  // refresh token here; provision a separate Supabase Auth session.
  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession({
    refresh_token: envSchema.WORKER_REFRESH_TOKEN,
  });

  if (refreshError || !refreshed.session || refreshed.user?.id !== envSchema.WORKER_USER_ID) {
    await supabase.from("worker_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", envSchema.WORKER_USER_ID);
    throw new Error("Unable to refresh dedicated worker session");
  }

  const claims = decodeJwtPayload(refreshed.session.access_token);
  if (claims.sub !== envSchema.WORKER_USER_ID || claims.worker !== true) {
    await supabase.from("worker_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", envSchema.WORKER_USER_ID);
    throw new Error("Supabase worker Auth Hook is not enabled or did not issue the worker claim");
  }

  const secretId = envSchema.TOKEN_VAULT_SECRET_PREFIX.replace(/\/+$/, "") +
    "/" + envSchema.WORKER_USER_ID + "/" + tokenVaultRef;
  const secretValue = JSON.stringify({
    userId: envSchema.WORKER_USER_ID,
    accessToken: refreshed.session.access_token,
    refreshToken: refreshed.session.refresh_token,
    expiresAt: (refreshed.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000,
  });

  const secrets = new SecretsManagerClient({ region: envSchema.AWS_REGION });
  try {
    await secrets.send(new CreateSecretCommand({
      Name: secretId,
      SecretString: secretValue,
      ...(process.env.TOKEN_VAULT_KMS_KEY_ID
        ? { KmsKeyId: process.env.TOKEN_VAULT_KMS_KEY_ID }
        : {}),
    }));
  } catch (error) {
    if ((error as { name?: string }).name !== "ResourceExistsException") {
      await supabase.from("worker_sessions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_id", envSchema.WORKER_USER_ID);
      throw new Error("Unable to create token-vault secret");
    }
    await secrets.send(new PutSecretValueCommand({
      SecretId: secretId,
      SecretString: secretValue,
    }));
  }

  console.info(JSON.stringify({
    event: "worker_session_provisioned",
    userId: envSchema.WORKER_USER_ID,
    // The opaque reference is intentionally not printed.
  }));
}

main().catch(() => {
  console.error(JSON.stringify({
    event: "worker_session_provision_failed",
    errorCode: "WORKER_SESSION_PROVISION_FAILED",
  }));
  process.exitCode = 1;
});
