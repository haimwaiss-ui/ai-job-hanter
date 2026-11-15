import { describe, expect, it, vi } from "vitest";
import { assertWorkerTenant } from "./tenant-client";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

const userA = "10000000-0000-4000-8000-000000000001";
const userB = "20000000-0000-4000-8000-000000000002";
const tokenVaultRef = "30000000-0000-4000-8000-000000000003";

function fakeClient(userId: string, workerEnabled = true) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId } },
        error: null,
      }),
    },
    rpc: vi.fn().mockResolvedValue({
      data: [{ user_id: userId, worker_enabled: workerEnabled, token_vault_ref: tokenVaultRef }],
      error: null,
    }),
  } as unknown as SupabaseClient<Database>;
}

describe("worker tenant assertion", () => {
  it("accepts only a verified matching auth user and Postgres auth.uid()", async () => {
    const client = fakeClient(userA);
    await expect(assertWorkerTenant(client, userA, tokenVaultRef)).resolves.toBeUndefined();
    expect(client.rpc).toHaveBeenCalledWith("worker_current_context");
  });

  it("rejects a payload userId that differs from the authenticated user", async () => {
    const client = fakeClient(userA);
    await expect(assertWorkerTenant(client, userB, tokenVaultRef)).rejects.toThrow("tenant identity mismatch");
  });

  it("rejects a token without the worker claim", async () => {
    const client = fakeClient(userA, false);
    await expect(assertWorkerTenant(client, userA, tokenVaultRef)).rejects.toThrow("worker JWT claim");
  });

  it("rejects a stale JWT bound to a rotated vault reference", async () => {
    const client = fakeClient(userA);
    await expect(assertWorkerTenant(client, userA, userB)).rejects.toThrow("worker JWT claim");
  });
});
