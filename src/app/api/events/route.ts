import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { activityEventSchema } from "@/lib/validation/job-hunter";
import {
  contentLengthExceeds,
  hasJsonContentType,
  isSameOriginMutation,
  MAX_JSON_BODY_BYTES,
} from "@/lib/http/request-guards";

export const runtime = "nodejs";

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
  const parsed = activityEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Unsupported activity event" }, { status: 422 });
  }

  const { error } = await supabase.from("user_activity_events").insert({
    user_id: user.id,
    event_type: parsed.data.event_type,
    entity_type: parsed.data.entity_type ?? null,
    entity_id: parsed.data.entity_id ?? null,
    payload: parsed.data.payload ?? {},
  });

  if (error) {
    return NextResponse.json({ error: "Unable to save activity event" }, { status: 400 });
  }
  return NextResponse.json({ saved: true });
}
