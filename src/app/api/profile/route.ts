import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { profileUpdateSchema } from "@/lib/validation/job-hunter";
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

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Unable to load profile" }, { status: 500 });
  }
  return NextResponse.json({ profile: data });
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
  const parsed = profileUpdateSchema.safeParse(body);
  if (!parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
    return NextResponse.json({ error: "Invalid profile update" }, { status: 422 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Unable to save profile" }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: "Profile not found; signup provisioning must complete first" }, { status: 404 });
  }

  const { error: eventError } = await supabase.from("user_activity_events").insert({
    user_id: user.id,
    event_type: "profile_updated",
    entity_type: "resume",
    payload: { fields: Object.keys(parsed.data).join(",") },
  });
  if (eventError) {
    console.warn("profile_activity_event_write_failed");
  }

  return NextResponse.json({ profile: data });
}
