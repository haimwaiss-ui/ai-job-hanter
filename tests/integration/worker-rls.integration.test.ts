import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/database.types";

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const tokenA = process.env.TEST_USER_A_ACCESS_TOKEN ?? "";
const tokenB = process.env.TEST_USER_B_ACCESS_TOKEN ?? "";
const testProjectId = process.env.SUPABASE_TEST_PROJECT_ID ?? "";
const actualProjectId = (() => {
  try { return new URL(supabaseUrl).hostname.split(".")[0]; } catch { return ""; }
})();
const enabled = Boolean(
  supabaseUrl && anonKey && tokenA && tokenB &&
  testProjectId && testProjectId === actualProjectId &&
  actualProjectId !== "lyroizvcfonhgdsibvqv"
);

function userClient(token: string): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: "Bearer " + token } },
  });
}

describe.skipIf(!enabled)("Supabase tenant RLS integration", () => {
  let clientA: SupabaseClient<Database>;
  let clientB: SupabaseClient<Database>;
  let userA = "";
  let userB = "";
  let eventId: string | null = null;

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
    if (eventId && clientA && userA) {
      await clientA.from("user_activity_events").delete().eq("id", eventId).eq("user_id", userA);
    }
  });

  it("hides another tenant's activity and blocks cross-tenant update/delete", async () => {
    const marker = "worker-rls-" + randomUUID();
    const { data: event, error: insertError } = await clientA.from("user_activity_events").insert({
      user_id: userA,
      event_type: "job_search",
      payload: { test_marker: marker },
    }).select("id").single();

    expect(insertError).toBeNull();
    expect(event?.id).toBeTruthy();
    eventId = event!.id;

    const { data: leakedRows, error: readError } = await clientB.from("user_activity_events")
      .select("id")
      .eq("id", eventId);
    expect(readError).toBeNull();
    expect(leakedRows).toEqual([]);

    const { data: changedRows, error: updateError } = await clientB.from("user_activity_events")
      .update({ payload: { test_marker: "cross-tenant-write" } })
      .eq("id", eventId)
      .select("id");
    expect(updateError !== null || changedRows?.length === 0).toBe(true);

    const { data: deletedRows, error: deleteError } = await clientB.from("user_activity_events")
      .delete()
      .eq("id", eventId)
      .select("id");
    expect(deleteError).toBeNull();
    expect(deletedRows).toEqual([]);

    const { data: ownerRows, error: ownerError } = await clientA.from("user_activity_events")
      .select("id,payload")
      .eq("id", eventId);
    expect(ownerError).toBeNull();
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows?.[0].payload).toEqual({ test_marker: marker });
  });
});
