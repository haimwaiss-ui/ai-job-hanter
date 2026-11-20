import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createIdempotencyKey } from "@/lib/queues/producer";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const workerJwt = process.env.WORKER_IDEMPOTENCY_JWT;
const enabled = Boolean(url && publishableKey && workerJwt);

describe("worker operation idempotency (live Supabase)", () => {
  it.skipIf(!enabled)("claims a tenant operation once and rejects a second enqueue identity", async () => {
    const supabase = createClient(url!, publishableKey!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: "Bearer " + workerJwt! } },
    });

    const { data: authData, error: authError } = await supabase.auth.getUser();
    expect(authError).toBeNull();
    expect(authData.user).toBeTruthy();

    const userId = authData.user!.id;
    const idempotencyKey = createIdempotencyKey(
      "scraper-queue",
      userId,
      "integration:" + randomUUID(),
    );

    const first = await supabase.rpc("claim_worker_operation", {
      p_queue_name: "scraper-queue",
      p_idempotency_key: idempotencyKey,
      p_operation_id: randomUUID(),
    });
    expect(first.error).toBeNull();
    expect(first.data).toBe(true);

    const duplicate = await supabase.rpc("claim_worker_operation", {
      p_queue_name: "scraper-queue",
      p_idempotency_key: idempotencyKey,
      p_operation_id: randomUUID(),
    });
    expect(duplicate.error).toBeNull();
    expect(duplicate.data).toBe(false);
  });
});
