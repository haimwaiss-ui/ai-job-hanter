import { describe, expect, it, vi } from "vitest";
import { assertWorkerTenant, createSignalBoundFetch } from "./tenant-client";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

const userA = "10000000-0000-4000-8000-000000000001";
const userB = "20000000-0000-4000-8000-000000000002";

function fakeClient(userId: string, workerEnabled = true) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId } },
        error: null,
      }),
    },
    rpc: vi.fn().mockResolvedValue({
      data: [{ user_id: userId, worker_enabled: workerEnabled }],
      error: null,
    }),
  } as unknown as SupabaseClient<Database>;
}

describe("worker timeout fetch cancellation", () => {
  it("propagates the job abort signal and preserves a request-level signal", async () => {
    const jobController = new AbortController();
    const requestController = new AbortController();
    const received: RequestInit[] = [];
    const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      received.push(init ?? {});
      return new Response("ok");
    }) as typeof fetch;

    const boundFetch = createSignalBoundFetch(jobController.signal, fakeFetch);
    await boundFetch("https://supabase.example/rest/v1/profiles", {
      method: "GET",
      signal: requestController.signal,
    });

    expect(received).toHaveLength(1);
    const requestSignal = received[0]?.signal;
    expect(requestSignal).toBeDefined();
    expect(requestSignal?.aborted).toBe(false);

    jobController.abort(new Error("worker timeout"));
    expect(requestSignal?.aborted).toBe(true);

    const secondJob = new AbortController();
    const secondRequest = new AbortController();
    const secondFetch = createSignalBoundFetch(secondJob.signal, fakeFetch);
    const pending = secondFetch("https://supabase.example/rest/v1/jobs", {
      signal: secondRequest.signal,
    });
    secondRequest.abort(new Error("caller cancelled"));
    await pending;
    expect(received[1]?.signal?.aborted).toBe(true);
  });
});

describe("worker tenant assertion", () => {
  it("accepts only a verified matching auth user and Postgres auth.uid()", async () => {
    const client = fakeClient(userA);
    await expect(assertWorkerTenant(client, userA)).resolves.toBeUndefined();
    expect(client.rpc).toHaveBeenCalledWith("worker_current_context");
  });

  it("rejects a payload userId that differs from the authenticated user", async () => {
    const client = fakeClient(userA);
    await expect(assertWorkerTenant(client, userB)).rejects.toThrow("tenant identity mismatch");
  });

  it("rejects a token without the worker claim", async () => {
    const client = fakeClient(userA, false);
    await expect(assertWorkerTenant(client, userA)).rejects.toThrow("worker JWT claim");
  });
});
