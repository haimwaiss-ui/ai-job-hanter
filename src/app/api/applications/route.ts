import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createApplicationForTenant,
  TenantServiceError,
  updateApplicationStatusForTenant,
} from "@/lib/services/applications";
import {
  contentLengthExceeds,
  hasJsonContentType,
  isSameOriginMutation,
  MAX_JSON_BODY_BYTES,
} from "@/lib/http/request-guards";

export const runtime = "nodejs";

function serviceErrorResponse(error: unknown) {
  if (error instanceof TenantServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Application operation failed" }, { status: 500 });
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("applications")
    .select("id,job_id,status,match_score,notes,created_at,applied_at,jobs(title,company_name,location,application_url,source_url)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Unable to load applications" }, { status: 500 });
  }
  return NextResponse.json({ applications: data ?? [] });
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
  if (body === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const application = await updateApplicationStatusForTenant(supabase, user.id, body);
    const { error: eventError } = await supabase.from("user_activity_events").insert({
      user_id: user.id,
      event_type: "application_status_changed",
      entity_type: "application",
      entity_id: application.id,
      payload: { status: application.status },
    });
    if (eventError) {
      console.warn("application_status_event_write_failed");
    }
    return NextResponse.json({ application });
  } catch (error) {
    return serviceErrorResponse(error);
  }
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
  if (body === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const application = await createApplicationForTenant(supabase, user.id, body);
    const { error: eventError } = await supabase.from("user_activity_events").insert({
      user_id: user.id,
      event_type: "application_created",
      entity_type: "application",
      entity_id: application.id,
      payload: { job_id: application.job_id },
    });
    if (eventError) {
      console.warn("application_created_event_write_failed");
    }
    return NextResponse.json({ application }, { status: 201 });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
