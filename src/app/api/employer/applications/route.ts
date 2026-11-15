import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasJsonContentType, isSameOriginMutation } from "@/lib/http/request-guards";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabase.from("employer_applications").select("id,employer_job_id,candidate_user_id,cover_letter,status,created_at,employer_jobs(title,department,location),profiles!employer_applications_candidate_profile_fk(full_name,headline,location,skills)").eq("employer_user_id", user.id).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Unable to load applicants" }, { status: 500 });
  return NextResponse.json({ applications: data ?? [] });
}

export async function PATCH(request: Request) {
  if (!isSameOriginMutation(request) || !hasJsonContentType(request)) return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { id?: string; status?: string } | null;
  if (!body?.id || !["new", "reviewing", "interview", "offer", "rejected", "hired"].includes(body.status ?? "")) return NextResponse.json({ error: "Invalid update" }, { status: 422 });
  const { data, error } = await supabase.from("employer_applications").update({ status: body.status, updated_at: new Date().toISOString() }).eq("id", body.id).eq("employer_user_id", user.id).select("*").maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Unable to update application" }, { status: 400 });
  return NextResponse.json({ application: data });
}
