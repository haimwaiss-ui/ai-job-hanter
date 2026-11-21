import { describe, expect, it } from "vitest";
import {
  gmailMessageListSchema,
  gmailMessageSchema,
  gmailScanRequestSchema,
  googleRefreshTokenResponseSchema,
} from "./gmail";

describe("Gmail scan validation", () => {
  it("accepts only an empty request object", () => {
    expect(gmailScanRequestSchema.safeParse({}).success).toBe(true);
    expect(gmailScanRequestSchema.safeParse({ user_id: "attacker" }).success).toBe(false);
    expect(gmailScanRequestSchema.safeParse("scan").success).toBe(false);
  });

  it("validates Google refresh responses and strips unknown fields", () => {
    const parsed = googleRefreshTokenResponseSchema.safeParse({
      access_token: "x".repeat(32),
      expires_in: 3600,
      token_type: "Bearer",
      refresh_token: "must-not-be-used",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect("refresh_token" in parsed.data).toBe(false);
    expect(googleRefreshTokenResponseSchema.safeParse({ access_token: "short" }).success).toBe(false);
  });

  it("rejects malformed or excessive Gmail message IDs", () => {
    expect(gmailMessageListSchema.safeParse({
      messages: [{ id: "A1b2_C-3" }],
      resultSizeEstimate: 1000,
    }).success).toBe(true);
    expect(gmailMessageListSchema.safeParse({ messages: [{ id: "../../other" }] }).success).toBe(false);
    expect(gmailMessageListSchema.safeParse({ messages: Array.from({ length: 31 }, (_, i) => ({ id: String(i) })) }).success).toBe(false);
  });

  it("accepts only bounded message metadata and strips provider fields", () => {
    const parsed = gmailMessageSchema.safeParse({
      id: "abc_123",
      snippet: "Interview invitation",
      payload: {
        headers: [{ name: "Subject", value: "Interview", internal_only: true }],
        body: { data: "not requested" },
      },
      internalDate: "123",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("internalDate" in parsed.data).toBe(false);
      expect("body" in (parsed.data.payload ?? {})).toBe(false);
      expect("internal_only" in (parsed.data.payload?.headers?.[0] ?? {})).toBe(false);
    }
    expect(gmailMessageSchema.safeParse({ id: "bad id" }).success).toBe(false);
  });
});
