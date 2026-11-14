import { createHash } from "node:crypto";
import type { WorkerQueueName } from "@/lib/queues/contracts";

export function createIdempotencyKey(
  queueName: WorkerQueueName,
  userId: string,
  scope: string,
): string {
  return createHash("sha256")
    .update([queueName, userId, scope].join("\u001f"))
    .digest("hex");
}

/** BullMQ custom job IDs must not contain a colon. */
export function createBullJobId(queueName: string, key: string): string {
  return queueName + "-" + key;
}
