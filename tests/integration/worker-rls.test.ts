import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const userAToken = process.env.WORKER_RLS_USER_A_JWT;
const userBToken = process.env.WORKER_RLS_USER_B_JWT;
const configured = Boolean(url && anonKey && userAToken && userBToken);

const suite = configured ? describe : describe.skip;

suite("worker tenant RLS isolation", () => {
  let userA: SupabaseClient | null = null;
  let userB: SupabaseClient | null = null;
  let userAId = "";
  let userBId = "";

  beforeAll(async () => {
    userA = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: "Bearer " + userAToken } },
    });
    userB = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: "Bearer " + userBToken } },
    });

    const [a, b] = await Promise.all([userA.auth.getUser(), userB.auth.getUser()]);
    if (a.error || b.error || !a.data.user || !b.data.user) {
      throw new Error("RLS integration test JWTs are invalid");
    }
    userAId = a.data.user.id;
    userBId = b.data.user.id;
    if (userAId === userBId) throw new Error("RLS test requires two distinct users");
  });

  afterAll(async () => {
    await Promise.all([userA?.auth.signOut(), userB?.auth.signOut()]);
  });

  it("never returns another tenant's jobs", async () => {
    const [aOwn, aOther, bOther] = await Promise.all([
      userA!.from("jobs").select("user_id").limit(50),
      userA!.from("jobs").select("id").eq("user_id", userBId),
      userB!.from("jobs").select("id").eq("user_id", userAId),
    ]);

    expect(aOwn.error).toBeNull();
    expect(aOther.error).toBeNull();
    expect(bOther.error).toBeNull();
    expect((aOwn.data ?? []).every((row) => row.user_id === userAId)).toBe(true);
    expect(aOther.data).toEqual([]);
    expect(bOther.data).toEqual([]);
  });

  it("rejects cross-tenant execution log writes", async () => {
    const { error } = await userA!.from("execution_logs").insert({
      user_id: userBId,
      execution_type: "system",
      status: "failed",
      operation: "rls-isolation-test",
      attempt_number: 1,
      metadata: { test: true },
    });

    expect(error).not.toBeNull();
  });
});
