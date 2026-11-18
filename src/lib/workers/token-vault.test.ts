import { describe, expect, it } from "vitest";
import { extractAuthSessionId, extractWorkerSessionClaims } from "./token-vault";

function jwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return header + "." + body + ".signature";
}

describe("worker Auth session binding", () => {
  it("extracts the session id from the access token claims", () => {
    const sessionId = "33333333-3333-4333-8333-333333333333";
    expect(extractAuthSessionId(jwt({ session_id: sessionId }))).toBe(sessionId);
  });

  it("rejects tokens without a valid session id", () => {
    expect(() => extractAuthSessionId("not-a-jwt")).toThrow("Invalid worker access token");
    expect(() => extractAuthSessionId(jwt({ session_id: "not-a-uuid" }))).toThrow("Invalid worker access token");
  });

  it("validates worker claim, user id, and dedicated session id together", () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const sessionId = "33333333-3333-4333-8333-333333333333";
    expect(extractWorkerSessionClaims(jwt({
      sub: userId,
      session_id: sessionId,
      worker: true,
    }))).toEqual({ userId, sessionId, worker: true });
  });

  it("does not treat a normal user token as a worker token", () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const sessionId = "33333333-3333-4333-8333-333333333333";
    expect(extractWorkerSessionClaims(jwt({
      sub: userId,
      session_id: sessionId,
    })).worker).toBe(false);
  });

  it("rejects worker claims without a valid subject or session id", () => {
    expect(() => extractWorkerSessionClaims(jwt({ worker: true })))
      .toThrow("Invalid worker access token");
  });
});
