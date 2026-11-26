import { describe, expect, it } from "vitest";
import { parseUserApiRateLimitResult } from "./user-api-rate-limit";

describe("parseUserApiRateLimitResult", () => {
  it("accepts an allowed response from the authenticated rate-limit RPC", () => {
    expect(parseUserApiRateLimitResult([
      { allowed: true, retry_after_seconds: 60 },
    ])).toEqual({ allowed: true, retry_after_seconds: 60 });
  });

  it("accepts a denied response with a bounded retry interval", () => {
    expect(parseUserApiRateLimitResult([
      { allowed: false, retry_after_seconds: 17 },
    ])).toEqual({ allowed: false, retry_after_seconds: 17 });
  });

  it.each([
    null,
    [],
    [{ allowed: "true", retry_after_seconds: 10 }],
    [{ allowed: false, retry_after_seconds: 0 }],
    [{ allowed: false, retry_after_seconds: 61 }],
    [{ allowed: false, retry_after_seconds: 10, user_id: "unexpected" }],
    [{ allowed: false, retry_after_seconds: 10 }, { allowed: true, retry_after_seconds: 1 }],
  ])("rejects malformed RPC output: %j", (value) => {
    expect(parseUserApiRateLimitResult(value)).toBeNull();
  });
});
