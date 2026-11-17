import { describe, expect, it } from "vitest";
import {
  decodeAuthJwtClaims,
  validateProvisioningSessionPair,
} from "./provisioning";

const userId = "11111111-1111-4111-8111-111111111111";
const browserSessionId = "22222222-2222-4222-8222-222222222222";
const workerSessionId = "33333333-3333-4333-8333-333333333333";
const now = 1_800_000_000_000;

function jwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return header + "." + body + ".signature";
}

function claims(overrides: Record<string, unknown> = {}) {
  return decodeAuthJwtClaims(jwt({
    sub: userId,
    session_id: workerSessionId,
    iat: Math.floor(now / 1000) - 30,
    exp: Math.floor(now / 1000) + 3600,
    amr: [{ method: "otp", timestamp: Math.floor(now / 1000) - 30 }],
    ...overrides,
  }));
}

describe("trusted worker session provisioning", () => {
  it("accepts a fresh email-OTP session distinct from the browser session", () => {
    const user = claims({ session_id: browserSessionId, amr: [{ method: "password" }] });
    const worker = claims();

    expect(validateProvisioningSessionPair(user, worker, now)).toEqual({
      userId,
      workerSessionId,
    });
  });

  it("rejects a session for another user", () => {
    expect(() => validateProvisioningSessionPair(
      claims({ session_id: browserSessionId }),
      claims({ sub: "44444444-4444-4444-8444-444444444444" }),
      now,
    )).toThrow("PROVISIONING_USER_MISMATCH");
  });

  it("rejects reuse of the ordinary browser Auth session", () => {
    expect(() => validateProvisioningSessionPair(
      claims({ session_id: browserSessionId }),
      claims({ session_id: browserSessionId }),
      now,
    )).toThrow("WORKER_SESSION_MUST_BE_SEPARATE");
  });

  it("rejects stale, expiring, or non-OTP worker sessions", () => {
    const user = claims({ session_id: browserSessionId, amr: [{ method: "password" }] });
    expect(() => validateProvisioningSessionPair(user, claims({
      iat: Math.floor(now / 1000) - 601,
    }), now)).toThrow("WORKER_REAUTH_NOT_FRESH");
    expect(() => validateProvisioningSessionPair(user, claims({
      exp: Math.floor(now / 1000) + 30,
    }), now)).toThrow("WORKER_TOKEN_EXPIRING");
    expect(() => validateProvisioningSessionPair(user, claims({
      amr: [{ method: "password" }],
    }), now)).toThrow("EMAIL_OTP_REAUTH_REQUIRED");
  });

  it("rejects already elevated worker tokens and malformed JWTs", () => {
    expect(() => validateProvisioningSessionPair(
      claims({ session_id: browserSessionId, amr: [{ method: "password" }] }),
      claims({ worker: true }),
      now,
    )).toThrow("EXISTING_WORKER_TOKEN_NOT_ALLOWED");
    expect(() => decodeAuthJwtClaims("not-a-jwt")).toThrow("INVALID_AUTH_TOKEN");
  });
});
