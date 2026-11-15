import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { preferencesUpdateSchema } from "@/lib/validation/job-hunter";
import {
  contentLengthExceeds,
  hasJsonContentType,
  isSameOriginMutation,
  MAX_JSON_BODY_BYTES,
} from "@/lib/http/request-guards";

export const runtime = "nodejs";

const defaults = {
  scan_frequency: "daily" as const,
  scan_time: "08:00",
  timezone: "Asia/Jerusalem",
  scan_enabled: false,
  scan_sources: ["manual"],
  submission_mode: "approval" as const,
  min_match_score: 85,
  auto_submit_enabled: false,
  require_approval: true,
};

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let { data, error } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Unable to load preferences" }, { status: 500 });
  }

  if (!data) {
    const inserted = await supabase
      .from("user_preferences")
      .insert({ user_id: user.id, ...defaults })
      .select("*")
      .single();
    data = inserted.data;
    error = inserted.error;
  }

  if (error || !data) {
    return NextResponse.json({ error: "Unable to initialize preferences" }, { status: 400 });
  }
  return NextResponse.json({ preferences: data });
}

export async function PATCH(request: Request) {
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
  const parsed = preferencesUpdateSchema.safeParse(body);
  if (!parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
    return NextResponse.json({ error: "Invalid preferences payload" }, { status: 422 });
  }

  const { data, error } = await supabase
    .from("user_preferences")
    .upsert({
      user_id: user.id,
      ...parsed.data,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: "Unable to save preferences" }, { status: 400 });
  }

  const { error: eventError } = await supabase.from("user_activity_events").insert({
    user_id: user.id,
    event_type: "preference_updated",
    payload: { fields: Object.keys(parsed.data).join(",") },
  });
  if (eventError) {
    console.warn("preference_activity_event_write_failed");
  }

  return NextResponse.json({
    preferences: data,
    notice: data.auto_submit_enabled
      ? "העדפת הגשה נשמרה; מנוע הגשה אוטומטי עדיין אינו מחובר."
      : undefined,
  });
}
