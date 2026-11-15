import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasJsonContentType, isSameOriginMutation, MAX_JSON_BODY_BYTES, contentLengthExceeds } from "@/lib/http/request-guards";
import { isIsraeliLocality } from "@/lib/israeli-localities";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [{ data: company, error: companyError }, { data: jobs, error: jobsError }, { count }] = await Promise.all([
    supabase.from("employer_profiles").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("employer_jobs").select("*").eq("employer_user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("employer_applications").select("*", { count: "exact", head: true }).eq("employer_user_id", user.id),
  ]);
  if (companyError || jobsError) return NextResponse.json({ error: "Unable to load employer workspace" }, { status: 500 });
  return NextResponse.json({ company, jobs: jobs ?? [], applicantCount: count ?? 0 });
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
  if (contentLengthExceeds(request, MAX_JSON_BODY_BYTES)) return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.company_name !== "string" || !body.company_name.trim() || typeof body.title !== "string" || !body.title.trim() || typeof body.location !== "string" || !body.location.trim()) {
    return NextResponse.json({ error: "יש להזין שם חברה ושם משרה" }, { status: 422 });
  }
  try {
    if (!(await isIsraeliLocality(body.location))) return NextResponse.json({ error: "יש לבחור עיר או יישוב מהרשימה הרשמית" }, { status: 422 });
  } catch {
    return NextResponse.json({ error: "מאגר היישובים אינו זמין כרגע" }, { status: 503 });
  }
  const profile = {
    user_id: user.id,
    company_name: body.company_name.trim().slice(0, 160),
    company_website: typeof body.company_website === "string" ? body.company_website.slice(0, 300) : null,
    company_description: typeof body.company_description === "string" ? body.company_description.slice(0, 3000) : null,
    contact_name: typeof body.contact_name === "string" ? body.contact_name.slice(0, 160) : null,
    updated_at: new Date().toISOString(),
  };
  const { error: profileError } = await supabase.from("employer_profiles").upsert(profile, { onConflict: "user_id" });
  if (profileError) return NextResponse.json({ error: "לא ניתן לשמור את פרטי החברה" }, { status: 400 });
  const status = body.publish === true ? "published" : "draft";
  const { data: job, error } = await supabase.from("employer_jobs").insert({
    employer_user_id: user.id,
    title: body.title.trim().slice(0, 180),
    department: typeof body.department === "string" ? body.department.slice(0, 120) : null,
    description: typeof body.description === "string" ? body.description.slice(0, 12000) : "",
    location: typeof body.location === "string" ? body.location.slice(0, 120) : null,
    employment_type: typeof body.employment_type === "string" ? body.employment_type : "full_time",
    workplace_type: body.workplace_type === "remote" || body.workplace_type === "onsite" ? body.workplace_type : "hybrid",
    salary_range: typeof body.salary_range === "string" ? body.salary_range.slice(0, 100) : null,
    status,
  }).select("*").single();
  if (error) return NextResponse.json({ error: "לא ניתן ליצור את המשרה" }, { status: 400 });
  return NextResponse.json({ job }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { id?: string; status?: string } | null;
  if (!body?.id || !["draft", "published", "paused", "closed"].includes(body.status ?? "")) return NextResponse.json({ error: "Invalid update" }, { status: 422 });
  const { data, error } = await supabase.from("employer_jobs").update({ status: body.status, updated_at: new Date().toISOString() }).eq("id", body.id).eq("employer_user_id", user.id).select("*").maybeSingle();
  if (error || !data) return NextResponse.json({ error: "לא ניתן לעדכן את המשרה" }, { status: 400 });
  return NextResponse.json({ job: data });
}
