import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { QueueSet } from "./queues";
import { enqueueAiProcessing, QueueIngressError } from "./enqueue";

const userId = "10000000-0000-4000-8000-000000000001";
const jobId = "20000000-0000-4000-8000-000000000002";
const resumeId = "30000000-0000-4000-8000-000000000003";
const vaultRef = "40000000-0000-4000-8000-000000000004";

function query(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "not"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  return chain;
}

function makeSupabase(input?: {
  workerSession?: { data: unknown; error: unknown };
  job?: { data: unknown; error: unknown };
  resume?: { data: unknown; error: unknown };
}) {
  const from = vi.fn((table: string) => {
    if (table === "worker_sessions") {
      return query(input?.workerSession ?? {
        data: { token_vault_ref: vaultRef },
        error: null,
      });
    }
    if (table === "jobs") {
      return query(input?.job ?? { data: { id: jobId }, error: null });
    }
    if (table === "resumes") {
      return query(input?.resume ?? { data: { id: resumeId }, error: null });
    }
    throw new Error("Unexpected table");
  });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId } },
        error: null,
      }),
    },
    from,
  } as unknown as SupabaseClient<Database>;
}

describe("tenant-safe queue ingress helpers", () => {
  it("checks the completed worker session and both AI resource owners before enqueue", async () => {
    const supabase = makeSupabase();
    const add = vi.fn().mockResolvedValue({ id: "ai-processing-queue-job" });
    const queues = { aiProcessing: { add } } as unknown as QueueSet;

    await enqueueAiProcessing(supabase, queues, {
      userId,
      jobId,
      resumeId,
      mode: "match",
      modelVersion: "gpt-4o-mini",
    });

    expect(supabase.from).toHaveBeenNthCalledWith(1, "worker_sessions");
    expect(supabase.from).toHaveBeenNthCalledWith(2, "jobs");
    expect(supabase.from).toHaveBeenNthCalledWith(3, "resumes");
    expect(add).toHaveBeenCalledOnce();

    const payload = add.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.userId).toBe(userId);
    expect(payload.tokenVaultRef).toBe(vaultRef);
    expect(payload.jobId).toBe(jobId);
    expect(payload.resumeId).toBe(resumeId);
    expect(payload.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(payload).not.toHaveProperty("accessToken");
    expect(payload).not.toHaveProperty("refreshToken");
  });

  it("fails closed when the worker session has not completed vault provisioning", async () => {
    const supabase = makeSupabase({
      workerSession: { data: null, error: { code: "PGRST116" } },
    });
    const add = vi.fn();
    const queues = { aiProcessing: { add } } as unknown as QueueSet;

    await expect(enqueueAiProcessing(supabase, queues, {
      userId,
      jobId,
      resumeId,
      mode: "match",
      modelVersion: "gpt-4o-mini",
    })).rejects.toMatchObject({
      code: "WORKER_SESSION_NOT_PROVISIONED",
      status: 409,
    } satisfies Partial<QueueIngressError>);

    expect(add).not.toHaveBeenCalled();
  });

  it("rejects a resume owned by another tenant before creating a queue job", async () => {
    const supabase = makeSupabase({
      resume: { data: null, error: null },
    });
    const add = vi.fn();
    const queues = { aiProcessing: { add } } as unknown as QueueSet;

    await expect(enqueueAiProcessing(supabase, queues, {
      userId,
      jobId,
      resumeId,
      mode: "match",
      modelVersion: "gpt-4o-mini",
    })).rejects.toMatchObject({
      code: "RESUME_NOT_FOUND",
      status: 404,
    });

    expect(add).not.toHaveBeenCalled();
  });

  it("rejects extra credential fields through strict worker payload validation", async () => {
    const supabase = makeSupabase();
    const add = vi.fn();
    const queues = { aiProcessing: { add } } as unknown as QueueSet;

    await expect(enqueueAiProcessing(
      supabase,
      queues,
      {
        userId,
        jobId,
        resumeId,
        mode: "match",
        modelVersion: "gpt-4o-mini",
        refreshToken: "never-accept-this",
      } as never,
    )).rejects.toThrow();

    expect(add).not.toHaveBeenCalled();
  });
});
