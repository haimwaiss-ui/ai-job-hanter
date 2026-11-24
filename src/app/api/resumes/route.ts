import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resumeMetadataSchema } from "@/lib/validation/job-hunter";
import {
  contentLengthExceeds,
  hasMultipartFormDataContentType,
  isSameOriginMutation,
  readRequestBodyLimited,
  MAX_RESUME_REQUEST_BYTES,
} from "@/lib/http/request-guards";

export const runtime = "nodejs";

const MAX_RESUME_FILE_SIZE = 10 * 1024 * 1024;
const uuidSchema = z.string().uuid();

function safeFilename(value: string): string {
  const cleaned = value.replace(/[\/\\\0-\x1f\x7f]/g, "_").trim().slice(0, 255);
  return cleaned || "resume.pdf";
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("resumes")
    .select("id,name,original_filename,file_size_bytes,is_default,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Unable to load resumes" }, { status: 500 });
  }
  return NextResponse.json({ resumes: data ?? [] });
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  if (!hasMultipartFormDataContentType(request)) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 415 });
  }
  if (contentLengthExceeds(request, MAX_RESUME_REQUEST_BYTES)) {
    return NextResponse.json({ error: "Upload request too large" }, { status: 413 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bodyRead = await readRequestBodyLimited(request, MAX_RESUME_REQUEST_BYTES);
  if (!bodyRead.ok) {
    return NextResponse.json(
      { error: bodyRead.reason === "too_large" ? "Upload request too large" : "Unable to read upload body" },
      { status: bodyRead.reason === "too_large" ? 413 : 400 },
    );
  }

  // Parse only the bounded bytes. Do not let formData() consume an unbounded
  // incoming stream when Content-Length is missing or inaccurate.
  const boundedHeaders = new Headers(request.headers);
  boundedHeaders.delete("content-length");
  const boundedBody = new ArrayBuffer(bodyRead.bytes.byteLength);
  new Uint8Array(boundedBody).set(bodyRead.bytes);
  const boundedRequest = new Request(request.url, {
    method: "POST",
    headers: boundedHeaders,
    body: boundedBody,
  });
  const form = await boundedRequest.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Invalid upload form" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "PDF file is required" }, { status: 422 });
  }
  if (file.type !== "application/pdf" || file.size < 1 || file.size > MAX_RESUME_FILE_SIZE) {
    return NextResponse.json({ error: "Only PDF files up to 10 MiB are accepted" }, { status: 422 });
  }

  const signature = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
  if (signature !== "%PDF-") {
    return NextResponse.json({ error: "The uploaded file is not a valid PDF" }, { status: 422 });
  }

  const originalFilename = safeFilename(file.name);
  const rawName = form.get("name");
  const name = (typeof rawName === "string" && rawName.trim() ? rawName : originalFilename)
    .trim()
    .slice(0, 120);
  const storagePath = user.id + "/" + randomUUID() + ".pdf";

  const metadata = resumeMetadataSchema.safeParse({
    name,
    storage_path: storagePath,
    original_filename: originalFilename,
    file_size_bytes: file.size,
    mime_type: "application/pdf",
  });
  if (!metadata.success) {
    return NextResponse.json({ error: "Invalid resume metadata" }, { status: 422 });
  }

  const { error: uploadError } = await supabase.storage
    .from("resumes")
    .upload(storagePath, file, { contentType: "application/pdf", upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: "Unable to store resume PDF" }, { status: 400 });
  }

  const { data: resume, error: insertError } = await supabase
    .from("resumes")
    .insert({
      user_id: user.id,
      name: metadata.data.name,
      storage_bucket: "resumes",
      storage_path: metadata.data.storage_path,
      original_filename: metadata.data.original_filename ?? null,
      mime_type: metadata.data.mime_type,
      file_size_bytes: metadata.data.file_size_bytes,
    })
    .select("id,name,original_filename,file_size_bytes,is_default,created_at")
    .single();

  if (insertError) {
    const { error: cleanupError } = await supabase.storage.from("resumes").remove([storagePath]);
    return NextResponse.json({
      error: "Unable to register resume metadata",
      cleanupPending: Boolean(cleanupError),
    }, { status: 500 });
  }

  const { error: eventError } = await supabase.from("user_activity_events").insert({
    user_id: user.id,
    event_type: "resume_uploaded",
    entity_type: "resume",
    entity_id: resume.id,
    payload: { file_size_bytes: file.size, original_filename: originalFilename },
  });
  if (eventError) {
    console.warn("resume_activity_event_write_failed");
  }

  return NextResponse.json({ resume }, { status: 201 });
}

export async function DELETE(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const id = new URL(request.url).searchParams.get("id");
  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "A valid resume id is required" }, { status: 422 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: existing, error: readError } = await supabase
    .from("resumes")
    .select("id,storage_path")
    .eq("id", parsedId.data)
    .eq("user_id", user.id)
    .maybeSingle();

  if (readError) {
    return NextResponse.json({ error: "Unable to find resume" }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 });
  }

  const { data: deleted, error: deleteError } = await supabase
    .from("resumes")
    .delete()
    .eq("id", existing.id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (deleteError) {
    return NextResponse.json({ error: "Resume may be linked to an application and cannot be deleted" }, { status: 409 });
  }
  if (!deleted) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 });
  }

  const { error: storageError } = await supabase.storage
    .from("resumes")
    .remove([existing.storage_path]);

  if (storageError) {
    return NextResponse.json({ deleted: true, cleanupPending: true }, { status: 202 });
  }
  return NextResponse.json({ deleted: true });
}
