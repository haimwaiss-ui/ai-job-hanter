import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { parseUserApiRateLimitResult } from "@/lib/http/user-api-rate-limit";

type Bucket = "job_scan" | "gmail_scan";

const limits: Record<Bucket, number> = {
  job_scan: 3,
  gmail_scan: 2,
};

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const tokenA = process.env.TEST_USER_A_ACCESS_TOKEN ?? "";
const tokenB = process.env.TEST_USER_B_ACCESS_TOKEN ?? "";
const testProjectId = process.env.SUPABASE_TEST_PROJECT_ID ?? "";
const actualProjectId = (() => {
  try { return new URL(supabaseUrl).hostname.split(".")[0]; } catch { return ""; }
})();

// Deliberately refuse to run against the connected Production project.
const enabled = Boolean(
  supabaseUrl && anonKey && tokenA && tokenB &&
  testProjectId && testProjectId === actualProjectId &&
  actualProjectId !== "lyroizvcfonhgdsibvqv"
);

function userClient(token?: string): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(token ? { global: { headers: { Authorization: "Bearer " + token } } } : {}),
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function consume(client: SupabaseClient<Database>, bucket: Bucket) {
  const { data, error } = await client.rpc("consume_user_api_rate_limit", {
    p_bucket: bucket,
  });
  if (error) throw new Error("Rate-limit RPC failed: " + error.code);
  const parsed = parseUserApiRateLimitResult(data);
  if (!parsed) throw new Error("Rate-limit RPC returned an invalid response");
  return parsed;
}

/**
 * Dedicated integration users may have been used by a previous run. If their
 * current fixed window is exhausted, wait for it to expire before measuring
 * the exact quota. The test timeout allows one full 60-second window.
 */
async function primeFreshWindow(client: SupabaseClient<Database>, bucket: Bucket): Promise<void> {
  const first = await consume(client, bucket);
  if (first.allowed) return;

  await wait((first.retry_after_seconds + 1) * 1_000);
  const reset = await consume(client, bucket);
  expect(reset.allowed).toBe(true);
}

describe.skipIf(!enabled)("per-user API rate-limit integration", () => {
  let clientA: SupabaseClient<Database>;
  let clientB: SupabaseClient<Database>;
  let anonymousClient: SupabaseClient<Database>;

  beforeAll(async () => {
    clientA = userClient(tokenA);
    clientB = userClient(tokenB);
    anonymousClient = userClient();

    const [{ data: authA, error: errorA }, { data: authB, error: errorB }] = await Promise.all([
      clientA.auth.getUser(tokenA),
      clientB.auth.getUser(tokenB),
    ]);
    if (errorA || errorB || !authA.user || !authB.user || authA.user.id === authB.user.id) {
      throw new Error("Integration test requires two distinct valid Supabase users");
    }
  });

  afterAll(async () => {
    await Promise.all([
      clientA?.auth.signOut({ scope: "local" }),
      clientB?.auth.signOut({ scope: "local" }),
      anonymousClient?.auth.signOut({ scope: "local" }),
    ]);
  });

  it("enforces the job quota atomically and isolates a second tenant", async () => {
    await Promise.all([
      primeFreshWindow(clientA, "job_scan"),
      primeFreshWindow(clientB, "job_scan"),
    ]);

    const [tenantAResults, tenantBResult] = await Promise.all([
      Promise.all(Array.from({ length: limits.job_scan }, () => consume(clientA, "job_scan"))),
      consume(clientB, "job_scan"),
    ]);

    expect(tenantAResults.filter((result) => result.allowed)).toHaveLength(limits.job_scan - 1);
    expect(tenantAResults.filter((result) => !result.allowed)).toHaveLength(1);
    expect(tenantAResults.find((result) => !result.allowed)?.retry_after_seconds).toBeGreaterThan(0);
    expect(tenantBResult.allowed).toBe(true);
  }, 75_000);

  it("enforces the independent Gmail quota under concurrent requests", async () => {
    await primeFreshWindow(clientA, "gmail_scan");
    const results = await Promise.all(
      Array.from({ length: limits.gmail_scan }, () => consume(clientA, "gmail_scan")),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(limits.gmail_scan - 1);
    expect(results.filter((result) => !result.allowed)).toHaveLength(1);
  }, 75_000);

  it("denies anonymous execution", async () => {
    const { error } = await anonymousClient.rpc("consume_user_api_rate_limit", {
      p_bucket: "job_scan",
    });
    expect(error).not.toBeNull();
  });
});
