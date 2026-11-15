import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasJsonContentType, isSameOriginMutation, MAX_JSON_BODY_BYTES, contentLengthExceeds } from "@/lib/http/request-guards";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
  if (contentLengthExceeds(request, MAX_JSON_BODY_BYTES)) return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { job_id?: string; cover_letter?: string } | null;
  if (!body?.job_id) return NextResponse.json({ error: "Missing job id" }, { status: 422 });
  const { data: job, error: jobError } = await supabase.from("employer_jobs").select("id,employer_user_id,status").eq("id", body.job_id).eq("status", "published").maybeSingle();
  if (jobError || !job) return NextResponse.json({ error: "המשרה אינה זמינה להגשת מועמדות" }, { status: 404 });
  if (job.employer_user_id === user.id) return NextResponse.json({ error: "לא ניתן להגיש מועמדות למשרה של החברה שלך" }, { status: 403 });
  const { data, error } = await supabase.from("employer_applications").insert({
    employer_user_id: job.employer_user_id,
    employer_job_id: job.id,
    candidate_user_id: user.id,
    cover_letter: typeof body.cover_letter === "string" ? body.cover_letter.slice(0, 5000) : null,
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "כבר הגשת מועמדות למשרה הזו" : "לא ניתן להגיש מועמדות" }, { status: error.code === "23505" ? 409 : 400 });
  return NextResponse.json({ application: data }, { status: 201 });
}
