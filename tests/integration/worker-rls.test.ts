import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createIdempotencyKey } from "@/lib/queues/producer";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const tokenA = process.env.WORKER_RLS_USER_A_JWT;
const tokenB = process.env.WORKER_RLS_USER_B_JWT;
const enabled = Boolean(url && publishableKey && tokenA && tokenB);

function userScopedClient(jwt: string) {
  return createClient(url!, publishableKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: "Bearer " + jwt } },
  });
}

describe("worker tenant isolation (live Supabase)", () => {
  it.skipIf(!enabled)("allows the owner worker to read its operation but hides it from another tenant", async () => {
    const owner = userScopedClient(tokenA!);
    const other = userScopedClient(tokenB!);

    const [ownerAuth, otherAuth] = await Promise.all([
      owner.auth.getUser(),
      other.auth.getUser(),
    ]);
    expect(ownerAuth.error).toBeNull();
    expect(otherAuth.error).toBeNull();
    expect(ownerAuth.data.user).toBeTruthy();
    expect(otherAuth.data.user).toBeTruthy();
    expect(ownerAuth.data.user!.id).not.toBe(otherAuth.data.user!.id);

    const userId = ownerAuth.data.user!.id;
    const idempotencyKey = createIdempotencyKey(
      "scraper-queue",
      userId,
      "rls-integration:" + randomUUID(),
    );

    const claim = await owner.rpc("claim_worker_operation", {
      p_queue_name: "scraper-queue",
      p_idempotency_key: idempotencyKey,
      p_operation_id: randomUUID(),
    });
    expect(claim.error).toBeNull();
    expect(claim.data).toBe(true);

    const [ownerRows, otherRows] = await Promise.all([
      owner.from("worker_operations")
        .select("id")
        .eq("user_id", userId)
        .eq("queue_name", "scraper-queue")
        .eq("idempotency_key", idempotencyKey),
      other.from("worker_operations")
        .select("id")
        .eq("user_id", userId)
        .eq("queue_name", "scraper-queue")
        .eq("idempotency_key", idempotencyKey),
    ]);

    expect(ownerRows.error).toBeNull();
    expect(otherRows.error).toBeNull();
    expect(ownerRows.data).toHaveLength(1);
    expect(otherRows.data).toHaveLength(0);
  });
});
