import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/database.types";

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const tokenA = process.env.TEST_USER_A_ACCESS_TOKEN ?? "";
const tokenB = process.env.TEST_USER_B_ACCESS_TOKEN ?? "";
const enabled = Boolean(supabaseUrl && anonKey && tokenA && tokenB);

function userClient(token: string): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: "Bearer " + token } },
  });
}

describe.skipIf(!enabled)("Supabase worker tenant RLS integration", () => {
  let clientA: SupabaseClient<Database>;
  let clientB: SupabaseClient<Database>;
  let userA = "";
  let userB = "";
  let createdJobId: string | null = null;

  beforeAll(async () => {
    clientA = userClient(tokenA);
    clientB = userClient(tokenB);
    const [{ data: authA, error: errorA }, { data: authB, error: errorB }] = await Promise.all([
      clientA.auth.getUser(tokenA),
      clientB.auth.getUser(tokenB),
    ]);
    if (errorA || errorB || !authA.user || !authB.user || authA.user.id === authB.user.id) {
      throw new Error("Integration test requires two distinct valid Supabase users");
    }
    userA = authA.user.id;
    userB = authB.user.id;
  });

  afterAll(async () => {
    if (createdJobId && clientA && userA) {
      await clientA.from("jobs").delete().eq("id", createdJobId).eq("user_id", userA);
    }
  });

  it("hides another tenant's job and rejects a cross-tenant application foreign key", async () => {
    const marker = "worker-rls-" + randomUUID();
    const { data: job, error: insertError } = await clientA.from("jobs").insert({
      user_id: userA,
      title: "RLS integration fixture",
      company_name: "Private fixture",
      source: "integration_test",
      description: marker,
    }).select("id").single();

    expect(insertError).toBeNull();
    expect(job?.id).toBeTruthy();
    createdJobId = job!.id;

    const { data: leakedRows, error: readError } = await clientB.from("jobs")
      .select("id")
      .eq("id", createdJobId);
    expect(readError).toBeNull();
    expect(leakedRows).toEqual([]);

    const { error: crossTenantInsertError } = await clientB.from("applications").insert({
      user_id: userB,
      job_id: createdJobId,
      resume_id: null,
    });
    expect(crossTenantInsertError).not.toBeNull();
    expect(crossTenantInsertError?.code).toBe("23503");
  });
});
