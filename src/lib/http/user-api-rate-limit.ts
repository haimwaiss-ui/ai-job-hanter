import { z } from "zod";

const rateLimitRowSchema = z.object({
  allowed: z.boolean(),
  retry_after_seconds: z.number().int().min(1).max(60),
}).strict();

const rateLimitResponseSchema = z.array(rateLimitRowSchema).length(1);

/** Parse the PostgREST table-function response without trusting provider data. */
export function parseUserApiRateLimitResult(value: unknown) {
  const parsed = rateLimitResponseSchema.safeParse(value);
  return parsed.success ? parsed.data[0] : null;
}
