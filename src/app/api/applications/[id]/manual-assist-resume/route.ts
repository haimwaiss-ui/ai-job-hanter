import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const { data: application, error } = await supabase
    .from("applications")
    .select("manual_assist_required,manual_assist_url,manual_assist_resume_storage_path")
    .eq("id", id)
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Unable to load manual-assist details" }, { status: 503 });
  }
  if (!application || !application.manual_assist_required || !application.manual_assist_resume_storage_path) {
    return NextResponse.json({ error: "Manual-assist resume was not found" }, { status: 404 });
  }

  const storagePath = application.manual_assist_resume_storage_path;
  if (!storagePath.startsWith(authData.user.id + "/")) {
    return NextResponse.json({ error: "Resume ownership check failed" }, { status: 403 });
  }

  // Storage remains private. A short-lived signed URL is issued only after
  // authenticated, tenant-scoped database and Storage RLS checks.
  const { data: signed, error: signError } = await supabase.storage
    .from("resumes")
    .createSignedUrl(storagePath, 60, { download: true });

  if (signError || !signed?.signedUrl) {
    return NextResponse.json({ error: "Unable to create a secure resume download link" }, { status: 503 });
  }

  return NextResponse.json({
    downloadUrl: signed.signedUrl,
    applicationUrl: application.manual_assist_url,
    expiresInSeconds: 60,
  });
}
