import { randomUUID, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const workerToken = process.env.WORKER_IDEMPOTENCY_JWT;
const configured = Boolean(url && anonKey && workerToken);

const suite = configured ? describe : describe.skip;

suite("worker operation idempotency in Postgres", () => {
  it("distinguishes a live duplicate, a retry, and a terminal duplicate", async () => {
    const client = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: "Bearer " + workerToken } },
    });

    const { data: authData, error: authError } = await client.auth.getUser();
    expect(authError).toBeNull();
    expect(authData.user).toBeTruthy();

    const { data: contextData, error: contextError } = await client.rpc("worker_current_context");
    const context = Array.isArray(contextData) ? contextData[0] : undefined;
    expect(contextError).toBeNull();
    expect(context?.user_id).toBe(authData.user!.id);
    expect(context?.worker_enabled).toBe(true);

    const queueName = "ai-processing-queue" as const;
    const idempotencyKey = createHash("sha256").update(randomUUID()).digest("hex");
    const operationId = randomUUID();
    const claim = () => client.rpc("claim_worker_operation", {
      p_queue_name: queueName,
      p_idempotency_key: idempotencyKey,
      p_operation_id: operationId,
    });

    const first = await claim();
    expect(first.error).toBeNull();
    expect(first.data).toBe("claimed");

    const concurrentDuplicate = await claim();
    expect(concurrentDuplicate.error).toBeNull();
    expect(concurrentDuplicate.data).toBe("busy");

    const retryState = await client.from("worker_operations")
      .update({ status: "retrying", lease_until: null })
      .eq("user_id", authData.user!.id)
      .eq("queue_name", queueName)
      .eq("idempotency_key", idempotencyKey);
    expect(retryState.error).toBeNull();

    const retry = await claim();
    expect(retry.error).toBeNull();
    expect(retry.data).toBe("claimed");

    const completed = await client.from("worker_operations")
      .update({ status: "completed", lease_until: null, completed_at: new Date().toISOString() })
      .eq("user_id", authData.user!.id)
      .eq("queue_name", queueName)
      .eq("idempotency_key", idempotencyKey);
    expect(completed.error).toBeNull();

    const terminalDuplicate = await claim();
    expect(terminalDuplicate.error).toBeNull();
    expect(terminalDuplicate.data).toBe("duplicate");
  });
});
