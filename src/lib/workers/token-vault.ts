import {
  CreateSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type IORedis from "ioredis";

const vaultSessionSchema = z.object({
  userId: z.string().uuid(),
  accessToken: z.string().min(40),
  refreshToken: z.string().min(40),
  expiresAt: z.number().int().positive(),
}).strict();

type VaultSession = z.infer<typeof vaultSessionSchema>;

function toVaultSession(userId: string, session: UserAuthSession): VaultSession {
  if (!session.user || session.user.id !== userId) {
    throw new Error("Worker session identity mismatch");
  }
  const expiresAtSeconds = session.expires_at ??
    Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600);
  return vaultSessionSchema.parse({
    userId,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: expiresAtSeconds * 1000,
  });
}

export interface UserAuthSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number | null;
  expires_in?: number | null;
  user: { id: string };
}

export interface UserTokenVault {
  storeSession(userId: string, session: UserAuthSession, tokenVaultRef?: string): Promise<string>;
  updateSession(userId: string, tokenVaultRef: string, session: UserAuthSession): Promise<void>;
  withAccessToken<T>(
    tokenVaultRef: string,
    userId: string,
    run: (accessToken: string) => Promise<T>,
  ): Promise<T>;
}

export class AwsSecretsManagerTokenVault implements UserTokenVault {
  private readonly secrets: SecretsManagerClient;
  private readonly prefix: string;
  private readonly supabaseUrl: string;
  private readonly anonKey: string;

  constructor(
    private readonly redis: IORedis | undefined,
    options?: {
      secrets?: SecretsManagerClient;
      secretPrefix?: string;
      supabaseUrl?: string;
      anonKey?: string;
    },
  ) {
    const region = process.env.AWS_REGION;
    this.prefix = (options?.secretPrefix ?? process.env.TOKEN_VAULT_SECRET_PREFIX ?? "").replace(/\/+$/, "");
    this.supabaseUrl = options?.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    this.anonKey = options?.anonKey ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

    if (!region && !options?.secrets) throw new Error("AWS_REGION is required for the token vault");
    if (!this.prefix || !this.supabaseUrl || !this.anonKey) {
      throw new Error("Token vault configuration is incomplete");
    }
    this.secrets = options?.secrets ?? new SecretsManagerClient({ region });
  }

  async storeSession(
    userId: string,
    session: UserAuthSession,
    tokenVaultRef = randomUUID(),
  ): Promise<string> {
    const stored = toVaultSession(userId, session);
    if (!z.string().uuid().safeParse(tokenVaultRef).success) {
      throw new Error("Invalid token vault reference");
    }

    await this.secrets.send(new CreateSecretCommand({
      Name: this.secretId(userId, tokenVaultRef),
      SecretString: JSON.stringify(stored),
    }));
    return tokenVaultRef;
  }

  async updateSession(
    userId: string,
    tokenVaultRef: string,
    session: UserAuthSession,
  ): Promise<void> {
    if (!z.string().uuid().safeParse(tokenVaultRef).success) {
      throw new Error("Invalid token vault reference");
    }
    const stored = toVaultSession(userId, session);
    await this.secrets.send(new PutSecretValueCommand({
      SecretId: this.secretId(userId, tokenVaultRef),
      SecretString: JSON.stringify(stored),
    }));
  }

  async withAccessToken<T>(
    tokenVaultRef: string,
    userId: string,
    run: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    if (!z.string().uuid().safeParse(tokenVaultRef).success ||
        !z.string().uuid().safeParse(userId).success) {
      throw new Error("Invalid token vault reference");
    }

    const secretId = this.secretId(userId, tokenVaultRef);
    let session = await this.read(secretId, userId);
    if (session.expiresAt <= Date.now() + 90_000) {
      session = await this.refreshUnderLock(secretId, userId, tokenVaultRef, session);
    }

    // The token is passed only in memory to a user-scoped Supabase client.
    // Never attach it to a queue payload, logger, trace, metric, or exception.
    return run(session.accessToken);
  }

  private secretId(userId: string, tokenVaultRef: string): string {
    return this.prefix + "/" + userId + "/" + tokenVaultRef;
  }

  private async read(secretId: string, expectedUserId: string): Promise<VaultSession> {
    try {
      const result = await this.secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
      if (!result.SecretString) throw new Error("Missing secret value");
      const parsed = vaultSessionSchema.safeParse(JSON.parse(result.SecretString));
      if (!parsed.success || parsed.data.userId !== expectedUserId) {
        throw new Error("Vault identity mismatch");
      }
      return parsed.data;
    } catch {
      throw new Error("Unable to resolve worker credentials from the token vault");
    }
  }

  private async refreshUnderLock(
    secretId: string,
    userId: string,
    tokenVaultRef: string,
    initial: VaultSession,
  ): Promise<VaultSession> {
    const redis = this.redis;
    if (!redis) throw new Error("Redis is required to coordinate token refresh");
    const lockKey = "worker:vault-refresh:" + createHash("sha256")
      .update(userId + ":" + tokenVaultRef)
      .digest("hex");
    const lockToken = randomUUID();
    const lockDeadline = Date.now() + 12_000;
    let acquired = false;

    while (!acquired && Date.now() < lockDeadline) {
      acquired = (await redis.set(lockKey, lockToken, "PX", 30_000, "NX")) === "OK";
      if (!acquired) await sleep(250);
    }
    if (!acquired) throw new Error("Token vault refresh is busy; retry the job");

    try {
      const current = await this.read(secretId, userId);
      if (current.expiresAt > Date.now() + 90_000) return current;

      const authClient = createClient(this.supabaseUrl, this.anonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      const { data, error } = await authClient.auth.refreshSession({
        refresh_token: current.refreshToken,
      });
      if (error || !data.session || data.user?.id !== userId) {
        throw new Error("Worker session refresh failed");
      }

      const refreshed = vaultSessionSchema.parse({
        userId,
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: (data.session.expires_at ?? Math.floor(Date.now() / 1000) + data.session.expires_in) * 1000,
      });

      await this.secrets.send(new PutSecretValueCommand({
        SecretId: secretId,
        SecretString: JSON.stringify(refreshed),
      }));
      return refreshed;
    } catch {
      throw new Error("Unable to refresh worker credentials");
    } finally {
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        lockToken,
      );
    }
  }
}


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
