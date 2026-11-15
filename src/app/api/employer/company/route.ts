import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasJsonContentType, isSameOriginMutation, MAX_JSON_BODY_BYTES, contentLengthExceeds } from "@/lib/http/request-guards";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
  if (contentLengthExceeds(request, MAX_JSON_BODY_BYTES)) return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.company_name !== "string" || !body.company_name.trim()) return NextResponse.json({ error: "יש להזין שם חברה" }, { status: 422 });
  const { data, error } = await supabase.from("employer_profiles").upsert({
    user_id: user.id,
    company_name: body.company_name.trim().slice(0, 160),
    company_website: typeof body.company_website === "string" ? body.company_website.slice(0, 300) : null,
    company_description: typeof body.company_description === "string" ? body.company_description.slice(0, 3000) : null,
    contact_name: typeof body.contact_name === "string" ? body.contact_name.slice(0, 160) : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" }).select("*").single();
  if (error) return NextResponse.json({ error: "לא ניתן לשמור את פרטי החברה" }, { status: 400 });
  return NextResponse.json({ company: data });
}
