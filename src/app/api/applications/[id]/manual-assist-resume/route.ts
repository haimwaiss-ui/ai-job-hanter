import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSameOriginMutation } from "@/lib/http/request-guards";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { id } = await context.params;
  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid application id" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: application, error: applicationError } = await supabase
    .from("applications")
    .select("manual_assist_resume_storage_path")
    .eq("id", parsedId.data)
    .eq("user_id", authData.user.id)
    .single();

  const path = application?.manual_assist_resume_storage_path;
  if (applicationError || !path ||
      !path.startsWith(authData.user.id + "/") ||
      path.split("/").some((segment) => segment === "..")) {
    return NextResponse.json({ error: "Resume download is unavailable" }, { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from("resumes")
    .createSignedUrl(path, 60, { download: true });

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "Unable to create a private resume download" }, { status: 500 });
  }

  return NextResponse.json({ url: data.signedUrl, expiresInSeconds: 60 });
}
