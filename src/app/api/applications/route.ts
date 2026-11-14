import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createApplicationSchema } from "@/lib/validation/job-hunter";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();

  // getUser() validates the session with Supabase Auth; do not trust user IDs
  // supplied in JSON, headers, or unsigned cookies.
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  // user_id comes exclusively from the verified Auth identity.
  // The composite FKs and RLS independently enforce tenant ownership.
  const { data, error } = await supabase
    .from("applications")
    .insert({
      user_id: user.id,
      job_id: parsed.data.job_id,
      resume_id: parsed.data.resume_id ?? null,
      notes: parsed.data.notes ?? null,
    })
    .select("id, job_id, resume_id, status, created_at")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Unable to create application" },
      { status: error.code === "23505" ? 409 : 400 }
    );
  }

  return NextResponse.json({ application: data }, { status: 201 });
}
