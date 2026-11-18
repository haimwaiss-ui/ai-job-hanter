import {
  CreateSecretCommand,
  DeleteSecretCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "../lib/supabase/database.types";
import {
  decodeAuthJwtClaims,
  validateProvisioningSessionPair,
  workerProvisioningInputSchema,
} from "../lib/workers/provisioning";
import {
  assertWorkerTenant,
  createTenantWorkerClient,
} from "../lib/workers/tenant-client";

const environmentSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  AWS_REGION: z.string().min(1),
  TOKEN_VAULT_SECRET_PREFIX: z.string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9/_-]+$/)
    .refine((value) => !value.startsWith("/") && !value.endsWith("/")),
}).strict();

const vaultSecretSchema = z.object({
  userId: z.string().uuid(),
  sessionId: z.string().uuid(),
  accessToken: z.string().min(40),
  refreshToken: z.string().min(40),
  expiresAt: z.number().int().positive(),
}).strict();

type VaultSecret = z.infer<typeof vaultSecretSchema>;

async function readStdin(maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) throw new Error("PROVISIONING_INPUT_TOO_LARGE");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function authOptions() {
  return {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  };
}

async function revokeLocalSession(
  supabaseUrl: string,
  anonKey: string,
  accessToken: string,
): Promise<void> {
  await fetch(new URL("/auth/v1/logout?scope=local", supabaseUrl), {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: "Bearer " + accessToken,
    },
  }).catch(() => undefined);
}

async function main(): Promise<void> {
  if (!process.argv.includes("--confirm") || !process.argv.includes("--consent-confirmed")) {
    throw new Error("EXPLICIT_CONFIRMATION_REQUIRED");
  }

  const env = environmentSchema.parse({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    AWS_REGION: process.env.AWS_REGION,
    TOKEN_VAULT_SECRET_PREFIX: process.env.TOKEN_VAULT_SECRET_PREFIX,
  });
  const input = workerProvisioningInputSchema.parse(
    JSON.parse(await readStdin(24 * 1024)) as unknown,
  );

  const userClaims = decodeAuthJwtClaims(input.userAccessToken);
  const workerClaims = decodeAuthJwtClaims(input.workerAccessToken);
  const { userId, workerSessionId } = validateProvisioningSessionPair(
    userClaims,
    workerClaims,
  );

  const verifier = createClient<Database>(
    env.SUPABASE_URL,
    env.SUPABASE_ANON_KEY,
    authOptions(),
  );
  const [userVerification, workerVerification] = await Promise.all([
    verifier.auth.getUser(input.userAccessToken),
    verifier.auth.getUser(input.workerAccessToken),
  ]);
  if (
    userVerification.error ||
    workerVerification.error ||
    userVerification.data.user?.id !== userId ||
    workerVerification.data.user?.id !== userId
  ) {
    throw new Error("AUTH_SESSION_VERIFICATION_FAILED");
  }

  const service = createClient<Database>(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    authOptions(),
  );
  const lockToken = randomUUID();
  const { data: acquired, error: acquireError } = await service.rpc(
    "acquire_worker_provisioning_lock",
    {
      p_user_id: userId,
      p_lock_token: lockToken,
      p_lease_seconds: 600,
    },
  );
  if (acquireError || acquired !== true) {
    throw new Error("WORKER_PROVISIONING_LOCK_UNAVAILABLE");
  }

  let secrets: SecretsManagerClient | undefined;
  const vaultRef = randomUUID();
  const secretId = env.TOKEN_VAULT_SECRET_PREFIX + "/" + userId + "/" + vaultRef;

  let previousSession: Database["public"]["Tables"]["worker_sessions"]["Row"] | null = null;
  let sessionRowChanged = false;
  let secretCreated = false;
  let workerTokenToRevoke = input.workerAccessToken;

  try {
    secrets = new SecretsManagerClient({ region: env.AWS_REGION });
    const workerAuth = createClient<Database>(
      env.SUPABASE_URL,
      env.SUPABASE_ANON_KEY,
      authOptions(),
    );

    const { data: previous, error: previousError } = await service
      .from("worker_sessions")
      .select("user_id,token_vault_ref,auth_session_id,revoked_at,provisioned_at,created_at,updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (previousError) throw new Error("WORKER_SESSION_READ_FAILED");
    previousSession = previous;

    const initialSecret: VaultSecret = vaultSecretSchema.parse({
      userId,
      sessionId: workerSessionId,
      accessToken: input.workerAccessToken,
      refreshToken: input.workerRefreshToken,
      expiresAt: workerClaims.exp * 1000,
    });

    await secrets.send(new CreateSecretCommand({
      Name: secretId,
      Description: "AI Job Hunter dedicated worker Auth session",
      SecretString: JSON.stringify(initialSecret),
      Tags: [
        { Key: "application", Value: "ai-job-hunter" },
        { Key: "purpose", Value: "worker-session" },
      ],
    }));
    secretCreated = true;

    const { error: upsertError } = await service.from("worker_sessions").upsert({
      user_id: userId,
      token_vault_ref: vaultRef,
      auth_session_id: workerSessionId,
      revoked_at: null,
      provisioned_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (upsertError) throw new Error("WORKER_SESSION_WRITE_FAILED");
    sessionRowChanged = true;

    const { data: refreshed, error: refreshError } = await workerAuth.auth.refreshSession({
      refresh_token: input.workerRefreshToken,
    });
    if (refreshError || !refreshed.session || refreshed.user?.id !== userId) {
      throw new Error("WORKER_SESSION_REFRESH_FAILED");
    }

    workerTokenToRevoke = refreshed.session.access_token;
    const refreshedClaims = decodeAuthJwtClaims(refreshed.session.access_token);
    if (
      refreshedClaims.sub !== userId ||
      refreshedClaims.session_id !== workerSessionId ||
      refreshedClaims.worker !== true ||
      refreshedClaims.exp <= Math.floor(Date.now() / 1000) + 60
    ) {
      throw new Error("CUSTOM_ACCESS_TOKEN_HOOK_NOT_ACTIVE");
    }

    const finalSecret: VaultSecret = vaultSecretSchema.parse({
      userId,
      sessionId: workerSessionId,
      accessToken: refreshed.session.access_token,
      refreshToken: refreshed.session.refresh_token,
      expiresAt: (refreshed.session.expires_at ?? refreshedClaims.exp) * 1000,
    });

    // Store the rotated credentials before marking the row usable by workers.
    await secrets.send(new PutSecretValueCommand({
      SecretId: secretId,
      SecretString: JSON.stringify(finalSecret),
    }));

    const { data: activated, error: activationError } = await service
      .from("worker_sessions")
      .update({
        provisioned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("auth_session_id", workerSessionId)
      .eq("token_vault_ref", vaultRef)
      .is("revoked_at", null)
      .select("user_id")
      .maybeSingle();

    if (activationError || !activated) {
      throw new Error("WORKER_SESSION_ACTIVATION_FAILED");
    }

    await assertWorkerTenant(
      createTenantWorkerClient(refreshed.session.access_token),
      userId,
      refreshed.session.access_token,
    );

    if (previousSession && previousSession.token_vault_ref !== vaultRef) {
      const oldSecretId = env.TOKEN_VAULT_SECRET_PREFIX + "/" +
        userId + "/" + previousSession.token_vault_ref;
      await secrets.send(new DeleteSecretCommand({
        SecretId: oldSecretId,
        ForceDeleteWithoutRecovery: true,
      })).catch(() => {
        console.warn(JSON.stringify({ event: "old_worker_secret_cleanup_deferred" }));
      });
    }

    console.log(JSON.stringify({
      ok: true,
      status: "active",
      userId,
    }));
  } catch {
    if (sessionRowChanged) {
      try {
        const rollback = previousSession
          ? await service.from("worker_sessions")
              .upsert(previousSession, { onConflict: "user_id" })
          : await service.from("worker_sessions")
              .delete()
              .eq("user_id", userId)
              .eq("auth_session_id", workerSessionId);

        if (rollback.error) {
          await service.from("worker_sessions")
            .update({
              revoked_at: new Date().toISOString(),
              provisioned_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId)
            .eq("auth_session_id", workerSessionId);
          console.error(JSON.stringify({ event: "worker_session_rollback_failed_closed" }));
        }
      } catch {
        console.error(JSON.stringify({ event: "worker_session_rollback_failed_closed" }));
      }
    }

    if (secrets && secretCreated) {
      await secrets.send(new DeleteSecretCommand({
        SecretId: secretId,
        ForceDeleteWithoutRecovery: true,
      })).catch(() => undefined);
    }

    await revokeLocalSession(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, workerTokenToRevoke);
    throw new Error("WORKER_PROVISIONING_FAILED_ROLLED_BACK");
  } finally {
    try {
      const { error: releaseError } = await service.rpc("release_worker_provisioning_lock", {
        p_user_id: userId,
        p_lock_token: lockToken,
      });
      if (releaseError) {
        console.warn(JSON.stringify({ event: "worker_provisioning_lock_release_deferred" }));
      }
    } catch {
      console.warn(JSON.stringify({ event: "worker_provisioning_lock_release_deferred" }));
    }
    secrets?.destroy();
  }
}

main().catch(() => {
  // Never print tokens, SDK errors, secret names, or request bodies.
  console.error(JSON.stringify({
    ok: false,
    error: "WORKER_PROVISIONING_FAILED",
    hint: "Verify trusted control-plane configuration and the Supabase Custom Access Token Hook.",
  }));
  process.exitCode = 1;
});
