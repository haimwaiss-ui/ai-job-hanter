import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const tokenA = process.env.SUPABASE_USER_A_JWT;
const tokenB = process.env.SUPABASE_USER_B_JWT;
const enabled = Boolean(url && anonKey && tokenA && tokenB);

const clients: SupabaseClient[] = [];
function userClient(token: string) {
  const client = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: "Bearer " + token } },
  });
  clients.push(client);
  return client;
}

describe.skipIf(!enabled)("Supabase RLS tenant isolation", () => {
  afterAll(async () => {
    await Promise.all(clients.map((client) => client.auth.signOut().catch(() => undefined)));
  });

  it("does not expose another user's profile under a user-scoped JWT", async () => {
    const clientA = userClient(tokenA!);
    const clientB = userClient(tokenB!);
    const [{ data: authA, error: errorA }, { data: authB, error: errorB }] = await Promise.all([
      clientA.auth.getUser(),
      clientB.auth.getUser(),
    ]);

    expect(errorA).toBeNull();
    expect(errorB).toBeNull();
    expect(authA.user).toBeTruthy();
    expect(authB.user).toBeTruthy();
    expect(authA.user!.id).not.toBe(authB.user!.id);

    const { data, error } = await clientA
      .from("profiles")
      .select("user_id")
      .eq("user_id", authB.user!.id);

    expect(error).toBeNull();
    expect(data ?? []).not.toContainEqual({ user_id: authB.user!.id });
  });
});
