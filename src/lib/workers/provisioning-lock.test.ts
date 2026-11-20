import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  withWorkerProvisioningLease,
  WorkerProvisioningLeaseError,
} from "./provisioning-lock";

type RpcResult = { data: boolean | null; error: unknown | null };

function clientFor(
  handler: (name: string) => Promise<RpcResult>,
): SupabaseClient<Database> {
  return {
    rpc: vi.fn((name: string) => handler(name)),
  } as unknown as SupabaseClient<Database>;
}

describe("user-scoped worker provisioning lease", () => {
  it("acquires and releases a lease around successful provisioning", async () => {
    const calls: string[] = [];
    const supabase = clientFor(async (name) => {
      calls.push(name);
      return { data: true, error: null };
    });

    await expect(withWorkerProvisioningLease(
      supabase,
      "10000000-0000-4000-8000-000000000001",
      async (assertLease) => {
        assertLease();
        return "provisioned";
      },
      { renewEveryMs: 10_000 },
    )).resolves.toBe("provisioned");

    expect(calls).toEqual([
      "acquire_worker_provisioning_lock",
      "release_worker_provisioning_lock",
    ]);
  });

  it("does not run provisioning when another lease is active", async () => {
    const calls: string[] = [];
    const supabase = clientFor(async (name) => {
      calls.push(name);
      return { data: false, error: null };
    });
    const task = vi.fn(async () => "should-not-run");

    await expect(withWorkerProvisioningLease(
      supabase,
      "10000000-0000-4000-8000-000000000001",
      task,
    )).rejects.toBeInstanceOf(WorkerProvisioningLeaseError);

    expect(task).not.toHaveBeenCalled();
    expect(calls).toEqual(["acquire_worker_provisioning_lock"]);
  });

  it("stops the task when lease renewal is rejected", async () => {
    let renewals = 0;
    const calls: string[] = [];
    const supabase = clientFor(async (name) => {
      calls.push(name);
      if (name === "renew_worker_provisioning_lock") {
        renewals += 1;
        return { data: false, error: null };
      }
      return { data: true, error: null };
    });

    await expect(withWorkerProvisioningLease(
      supabase,
      "10000000-0000-4000-8000-000000000001",
      async (assertLease) => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        assertLease();
      },
      { leaseSeconds: 30, renewEveryMs: 10 },
    )).rejects.toBeInstanceOf(WorkerProvisioningLeaseError);

    expect(renewals).toBeGreaterThan(0);
    expect(calls[calls.length - 1]).toBe("release_worker_provisioning_lock");
  });

  it("releases the lease when the provisioning task throws", async () => {
    const calls: string[] = [];
    const supabase = clientFor(async (name) => {
      calls.push(name);
      return { data: true, error: null };
    });

    await expect(withWorkerProvisioningLease(
      supabase,
      "10000000-0000-4000-8000-000000000001",
      async () => {
        throw new Error("expected test failure");
      },
      { renewEveryMs: 10_000 },
    )).rejects.toThrow("expected test failure");

    expect(calls).toEqual([
      "acquire_worker_provisioning_lock",
      "release_worker_provisioning_lock",
    ]);
  });
});
