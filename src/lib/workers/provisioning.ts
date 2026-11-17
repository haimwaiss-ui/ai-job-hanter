import { z } from "zod";

const amrItemSchema = z.union([
  z.string(),
  z.object({ method: z.string() }).passthrough(),
]);

const authJwtClaimsSchema = z.object({
  sub: z.string().uuid(),
  session_id: z.string().uuid(),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
  worker: z.boolean().optional(),
  amr: z.array(amrItemSchema).optional(),
}).passthrough();

export type AuthJwtClaims = z.infer<typeof authJwtClaimsSchema>;

export const workerProvisioningInputSchema = z.object({
  userAccessToken: z.string().min(40).max(8192),
  workerAccessToken: z.string().min(40).max(8192),
  workerRefreshToken: z.string().min(40).max(8192),
}).strict();

export type WorkerProvisioningInput = z.infer<typeof workerProvisioningInputSchema>;

/** Decode only for claim comparison. Call Supabase Auth getUser() to verify signatures. */
export function decodeAuthJwtClaims(token: string): AuthJwtClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("INVALID_AUTH_TOKEN");

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as unknown;
    return authJwtClaimsSchema.parse(payload);
  } catch {
    throw new Error("INVALID_AUTH_TOKEN");
  }
}

/**
 * Require a fresh, separate email-OTP Auth session for background work.
 * The caller's ordinary session proves account ownership; the second session
 * proves recent re-authentication and is the only session stored in the vault.
 */
export function validateProvisioningSessionPair(
  userClaims: AuthJwtClaims,
  workerClaims: AuthJwtClaims,
  nowMs = Date.now(),
): { userId: string; workerSessionId: string } {
  if (userClaims.sub !== workerClaims.sub) {
    throw new Error("PROVISIONING_USER_MISMATCH");
  }
  if (userClaims.session_id === workerClaims.session_id) {
    throw new Error("WORKER_SESSION_MUST_BE_SEPARATE");
  }
  if (userClaims.worker === true || workerClaims.worker === true) {
    throw new Error("EXISTING_WORKER_TOKEN_NOT_ALLOWED");
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  if (
    workerClaims.iat > nowSeconds + 30 ||
    workerClaims.iat < nowSeconds - 5 * 60
  ) {
    throw new Error("WORKER_REAUTH_NOT_FRESH");
  }
  if (workerClaims.exp <= nowSeconds + 60) {
    throw new Error("WORKER_TOKEN_EXPIRING");
  }

  const usedEmailOtp = (workerClaims.amr ?? []).some((item) =>
    typeof item === "string" ? item === "otp" : item.method === "otp",
  );
  if (!usedEmailOtp) {
    throw new Error("EMAIL_OTP_REAUTH_REQUIRED");
  }

  return {
    userId: workerClaims.sub,
    workerSessionId: workerClaims.session_id,
  };
}
