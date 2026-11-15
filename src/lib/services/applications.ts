import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  createApplicationSchema,
  updateApplicationSchema,
} from "@/lib/validation/job-hunter";

type TenantClient = SupabaseClient<Database>;

export class TenantServiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "TenantServiceError";
  }
}

async function assertTenant(client: TenantClient, expectedUserId: string): Promise<void> {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user || user.id !== expectedUserId) {
    throw new TenantServiceError("Unauthorized", 401);
  }
}

export async function createApplicationForTenant(
  client: TenantClient,
  userId: string,
  input: unknown,
) {
  await assertTenant(client, userId);
  const parsed = createApplicationSchema.safeParse(input);
  if (!parsed.success) {
    throw new TenantServiceError("Invalid application payload", 422);
  }

  const { data, error } = await client.from("applications").insert({
    user_id: userId,
    job_id: parsed.data.job_id,
    resume_id: parsed.data.resume_id ?? null,
    notes: parsed.data.notes ?? null,
  }).select("id,job_id,resume_id,status,created_at").single();

  if (error) {
    throw new TenantServiceError(
      "Unable to create application",
      error.code === "23505" || error.code === "23503" ? 409 : 400,
    );
  }
  return data;
}

export async function updateApplicationStatusForTenant(
  client: TenantClient,
  userId: string,
  input: unknown,
) {
  await assertTenant(client, userId);
  const parsed = updateApplicationSchema.safeParse(input);
  if (!parsed.success) {
    throw new TenantServiceError("Invalid application update", 422);
  }

  const { data, error } = await client.from("applications")
    .update({
      status: parsed.data.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.id)
    .eq("user_id", userId)
    .select("id,status,job_id")
    .maybeSingle();

  if (error) {
    throw new TenantServiceError("Unable to update application", 400);
  }
  if (!data) {
    throw new TenantServiceError("Application not found", 404);
  }
  return data;
}
