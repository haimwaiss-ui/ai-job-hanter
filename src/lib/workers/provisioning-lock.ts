import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export class WorkerProvisioningLeaseError extends Error {
  constructor(message = "Worker provisioning lease is unavailable") {
    super(message);
    this.name = "WorkerProvisioningLeaseError";
  }
}

export interface WorkerProvisioningLeaseOptions {
  leaseSeconds?: number;
  renewEveryMs?: number;
}

/**
 * Serializes trusted worker provisioning with user-scoped SECURITY INVOKER RPCs.
 * The supplied client must carry the target user's own JWT; never pass a
 * service-role client. This helper is for the local control-plane CLI only.
 * Never import it into browser code, user-facing API routes, or the BullMQ runtime.
 */
export async function withWorkerProvisioningLease<T>(
  supabase: SupabaseClient<Database>,
  userId: string,
  task: (assertLease: () => void) => Promise<T>,
  options: WorkerProvisioningLeaseOptions = {},
): Promise<T> {
  const leaseSeconds = options.leaseSeconds ?? 300;
  const renewEveryMs = options.renewEveryMs ?? 60_000;

  if (
    !Number.isInteger(leaseSeconds) ||
    leaseSeconds < 30 ||
    leaseSeconds > 600 ||
    !Number.isFinite(renewEveryMs) ||
    renewEveryMs < 1 ||
    renewEveryMs >= leaseSeconds * 1_000
  ) {
    throw new WorkerProvisioningLeaseError("Invalid worker provisioning lease settings");
  }

  const lockToken = randomUUID();
  const { data: acquired, error: acquireError } = await supabase.rpc(
    "acquire_worker_provisioning_lock",
    {
      p_user_id: userId,
      p_lock_token: lockToken,
      p_lease_seconds: leaseSeconds,
    },
  );

  if (acquireError || acquired !== true) {
    throw new WorkerProvisioningLeaseError("Another worker provisioning operation is active");
  }

  let leaseLost = false;
  let renewalInFlight: Promise<void> | null = null;

  const assertLease = () => {
    if (leaseLost) {
      throw new WorkerProvisioningLeaseError("Worker provisioning lease was lost");
    }
  };

  const timer = setInterval(() => {
    if (renewalInFlight) return;

    renewalInFlight = (async () => {
      const { data: renewed, error } = await supabase.rpc(
        "renew_worker_provisioning_lock",
        {
          p_user_id: userId,
          p_lock_token: lockToken,
          p_lease_seconds: leaseSeconds,
        },
      );
      if (error || renewed !== true) leaseLost = true;
    })()
      .catch(() => {
        leaseLost = true;
      })
      .finally(() => {
        renewalInFlight = null;
      });
  }, renewEveryMs);

  try {
    const result = await task(assertLease);
    // The task performs its own final lease assertion before committing the
    // active session. Do not invalidate a completed task if the lease expires
    // in the tiny interval after that assertion.
    return result;
  } finally {
    clearInterval(timer);
    if (renewalInFlight) await renewalInFlight;

    const { data: released, error: releaseError } = await supabase.rpc(
      "release_worker_provisioning_lock",
      {
        p_user_id: userId,
        p_lock_token: lockToken,
      },
    );

    if (releaseError || released !== true) {
      // The lease is time-bounded and will expire even if release is unavailable.
      console.warn(JSON.stringify({ event: "worker_provisioning_lock_release_deferred" }));
    }
  }
}
