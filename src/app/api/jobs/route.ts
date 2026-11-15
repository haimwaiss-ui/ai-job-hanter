import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createJobSchema } from "@/lib/validation/job-hunter";
import {
  contentLengthExceeds,
  hasJsonContentType,
  isSameOriginMutation,
  MAX_JSON_BODY_BYTES,
} from "@/lib/http/request-guards";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [{ data, error }, { data: employerJobs, error: employerJobsError }] = await Promise.all([
    supabase.from("jobs").select("*").eq("user_id", user.id).eq("is_active", true).order("created_at", { ascending: false }),
    supabase.from("employer_jobs").select("id,title,department,description,location,workplace_type,employment_type,created_at,employer_user_id").eq("status", "published").order("created_at", { ascending: false }).limit(100),
  ]);

  if (error || employerJobsError) {
    return NextResponse.json({ error: "Unable to load jobs" }, { status: 500 });
  }
  return NextResponse.json({ jobs: data ?? [], employer_jobs: employerJobs ?? [] });
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
  }
  if (contentLengthExceeds(request, MAX_JSON_BODY_BYTES)) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = createJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid job payload" }, { status: 422 });
  }

  const input = parsed.data;
  const { data: job, error } = await supabase.from("jobs").insert({
    user_id: user.id,
    source: "manual",
    source_url: input.source_url ?? input.application_url ?? "",
    application_url: input.application_url ?? input.source_url ?? null,
    title: input.title,
    company_name: input.company_name,
    company_website: input.company_website ?? null,
    location: input.location ?? null,
    country_code: input.country_code ?? null,
    description: input.description ?? null,
    employment_type: input.employment_type ?? null,
    remote: input.remote ?? false,
    salary_min: input.salary_min ?? null,
    salary_max: input.salary_max ?? null,
    salary_currency: input.salary_currency ?? null,
    required_skills: input.required_skills ?? [],
    preferred_skills: input.preferred_skills ?? [],
    experience_level: input.experience_level ?? null,
  }).select("*").single();

  if (error) {
    return NextResponse.json({ error: "Unable to save job" }, { status: error.code === "23505" ? 409 : 400 });
  }

  const { error: eventError } = await supabase.from("user_activity_events").insert({
    user_id: user.id,
    event_type: "job_added",
    entity_type: "job",
    entity_id: job.id,
    payload: { source: "manual" },
  });
  if (eventError) {
    console.warn("job_activity_event_write_failed");
  }

  return NextResponse.json({ job }, { status: 201 });
}
