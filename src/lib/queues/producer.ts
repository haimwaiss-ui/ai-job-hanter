import { createHash } from "node:crypto";
import type { WorkerQueueName } from "./contracts";

/**
 * Derive an idempotency key from tenant + operation identity. The key is safe
 * to store in Redis and Postgres; it contains no credentials or user content.
 */
export function createIdempotencyKey(
  queueName: WorkerQueueName,
  userId: string,
  operationIdentity: string,
): string {
  if (!userId || !operationIdentity.trim()) {
    throw new Error("Queue idempotency identity is incomplete");
  }

  return createHash("sha256")
    .update(queueName)
    .update("\0")
    .update(userId)
    .update("\0")
    .update(operationIdentity)
    .digest("hex");
}

/** BullMQ custom job IDs must not contain a colon. */
export function createBullJobId(idempotencyKey: string): string {
  if (!/^[a-f0-9]{64}$/i.test(idempotencyKey)) {
    throw new Error("Invalid queue idempotency key");
  }
  return "ajh-" + idempotencyKey.toLowerCase();
}
