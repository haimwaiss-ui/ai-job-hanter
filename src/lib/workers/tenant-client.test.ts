import { describe, expect, it, vi } from "vitest";
import { assertWorkerTenant } from "./tenant-client";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

const userA = "10000000-0000-4000-8000-000000000001";
const userB = "20000000-0000-4000-8000-000000000002";
const accessToken = "test-access-token-that-is-long-enough-for-auth-verification";

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

describe("worker tenant assertion", () => {
  it("accepts only a verified matching auth user and Postgres auth.uid()", async () => {
    const client = fakeClient(userA);
    await expect(assertWorkerTenant(client, userA, accessToken)).resolves.toBeUndefined();
    expect(client.auth.getUser).toHaveBeenCalledWith(accessToken);
    expect(client.rpc).toHaveBeenCalledWith("worker_current_context");
  });

  it("rejects a payload userId that differs from the authenticated user", async () => {
    const client = fakeClient(userA);
    await expect(assertWorkerTenant(client, userB, accessToken)).rejects.toThrow("tenant identity mismatch");
  });

  it("rejects a token without the worker claim", async () => {
    const client = fakeClient(userA, false);
    await expect(assertWorkerTenant(client, userA, accessToken)).rejects.toThrow("worker JWT claim");
  });
});
