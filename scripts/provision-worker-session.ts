import {
  CreateSecretCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";
import { withWorkerProvisioningLease } from "@/lib/workers/provisioning-lock";
import { buildVaultSessionSecret, extractAuthSessionId } from "@/lib/workers/token-vault";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  AWS_REGION: z.string().min(1),
  TOKEN_VAULT_SECRET_PREFIX: z.string().min(1),
  WORKER_USER_ID: z.string().uuid(),
  WORKER_EMAIL: z.string().email(),
}).parse(process.env);

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  if (!part) throw new Error("Invalid JWT format");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

function expiresAtMs(session: {
  expires_at?: number;
  expires_in: number;
}): number {
  return (session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in) * 1000;
}

async function createOrUpdateVaultSecret(
  secrets: SecretsManagerClient,
  secretId: string,
  secretValue: string,
): Promise<void> {
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
      throw new Error("Unable to create worker token-vault secret");
    }
    await secrets.send(new PutSecretValueCommand({
      SecretId: secretId,
      SecretString: secretValue,
    }));
  }
}

async function main(): Promise<void> {
  const supabase = createClient<Database>(
    envSchema.NEXT_PUBLIC_SUPABASE_URL,
    envSchema.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );

  const { error: otpError } = await supabase.auth.signInWithOtp({
    email: envSchema.WORKER_EMAIL,
    options: { shouldCreateUser: false },
  });
  if (otpError) throw new Error("Unable to start dedicated worker email sign-in");

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let otpCode: string;
  try {
    otpCode = (await prompt.question("Enter the email verification code for the dedicated worker session: ")).trim();
  } finally {
    prompt.close();
  }
  if (!/^\d{4,12}$/.test(otpCode)) throw new Error("Invalid worker email verification code");

  const { data: verified, error: verifyError } = await supabase.auth.verifyOtp({
    email: envSchema.WORKER_EMAIL,
    token: otpCode,
    type: "email",
  });
  if (verifyError || !verified.session || verified.user?.id !== envSchema.WORKER_USER_ID) {
    throw new Error("Dedicated worker sign-in did not match the requested user");
  }

  const initialSession = verified.session;
  const authSessionId = extractAuthSessionId(initialSession.access_token);
  const { data: authData, error: authError } = await supabase.auth.getUser(initialSession.access_token);
  if (authError || !authData.user || authData.user.id !== envSchema.WORKER_USER_ID) {
    throw new Error("Dedicated worker session identity could not be verified");
  }

  const secrets = new SecretsManagerClient({ region: envSchema.AWS_REGION });

  await withWorkerProvisioningLease(
    supabase,
    envSchema.WORKER_USER_ID,
    async (assertLease) => {
      assertLease();
      const { data: existing, error: existingError } = await supabase
        .from("worker_sessions")
        .select("token_vault_ref")
        .eq("user_id", envSchema.WORKER_USER_ID)
        .maybeSingle();
      if (existingError) throw new Error("Unable to read existing worker session");

      const tokenVaultRef = existing?.token_vault_ref ?? randomUUID();
      assertLease();
      const secretId = envSchema.TOKEN_VAULT_SECRET_PREFIX.replace(/\/+$/, "") +
        "/" + envSchema.WORKER_USER_ID + "/" + tokenVaultRef;

      const { error: registerError } = await supabase
        .from("worker_sessions")
        .upsert({
          user_id: envSchema.WORKER_USER_ID,
          token_vault_ref: tokenVaultRef,
          auth_session_id: authSessionId,
          revoked_at: null,
          provisioned_at: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
      if (registerError) throw new Error("Unable to register the dedicated worker session");

      try {
        assertLease();
        const initialSecret = JSON.stringify(buildVaultSessionSecret({
          userId: envSchema.WORKER_USER_ID,
          accessToken: initialSession.access_token,
          refreshToken: initialSession.refresh_token,
          expiresAt: expiresAtMs(initialSession),
        }));
        await createOrUpdateVaultSecret(secrets, secretId, initialSecret);

        // Activate only after the initial secret is safely stored. The RPC is
        // SECURITY INVOKER and checks auth.uid() plus the exact JWT session_id.
        assertLease();
        const { data: completed, error: completionError } = await supabase.rpc(
          "complete_worker_provisioning",
        );
        if (completionError || completed !== true) {
          throw new Error("Worker provisioning completion was rejected");
        }

        assertLease();
        const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession({
          refresh_token: initialSession.refresh_token,
        });
        if (refreshError || !refreshed.session || refreshed.user?.id !== envSchema.WORKER_USER_ID) {
          throw new Error("Unable to refresh the dedicated worker session");
        }
        if (extractAuthSessionId(refreshed.session.access_token) !== authSessionId) {
          throw new Error("Worker Auth session changed during provisioning");
        }

        const { data: refreshedUser, error: refreshedUserError } = await supabase.auth.getUser(
          refreshed.session.access_token,
        );
        if (refreshedUserError || refreshedUser.user?.id !== envSchema.WORKER_USER_ID) {
          throw new Error("Refreshed worker session identity could not be verified");
        }

        const claims = decodeJwtPayload(refreshed.session.access_token);
        if (claims.sub !== envSchema.WORKER_USER_ID || claims.worker !== true) {
          throw new Error("Custom Access Token Hook did not issue the provisioned worker claim");
        }

        const { data: context, error: contextError } = await supabase.rpc("worker_current_context");
        const currentContext = Array.isArray(context) ? context[0] : undefined;
        if (
          contextError ||
          currentContext?.user_id !== envSchema.WORKER_USER_ID ||
          currentContext.worker_enabled !== true
        ) {
          throw new Error("Postgres did not confirm the active worker tenant context");
        }

        assertLease();
        const finalSecret = JSON.stringify(buildVaultSessionSecret({
          userId: envSchema.WORKER_USER_ID,
          accessToken: refreshed.session.access_token,
          refreshToken: refreshed.session.refresh_token,
          expiresAt: expiresAtMs(refreshed.session),
        }));
        await secrets.send(new PutSecretValueCommand({
          SecretId: secretId,
          SecretString: finalSecret,
        }));

        console.info(JSON.stringify({
          event: "worker_session_provisioned",
          userId: envSchema.WORKER_USER_ID,
          // The opaque vault reference and all credential material stay private.
        }));
      } catch {
        const { data: revoked, error: revokeError } = await supabase
          .from("worker_sessions")
          .update({
            revoked_at: new Date().toISOString(),
            provisioned_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", envSchema.WORKER_USER_ID)
          .select("user_id")
          .maybeSingle();

        if (revokeError || !revoked) {
          throw new Error("Provisioning failed and worker-session revocation could not be confirmed");
        }
        throw new Error("Worker provisioning failed; the dedicated session was revoked");
      }
    },
  );
}

main().catch(() => {
  console.error(JSON.stringify({
    event: "worker_session_provision_failed",
    errorCode: "WORKER_SESSION_PROVISION_FAILED",
  }));
  process.exitCode = 1;
});
