import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/database.types";

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const tokenA = process.env.TEST_USER_A_ACCESS_TOKEN ?? "";
const tokenB = process.env.TEST_USER_B_ACCESS_TOKEN ?? "";
const testProjectId = process.env.SUPABASE_TEST_PROJECT_ID ?? "";
const actualProjectId = (() => {
  try { return new URL(supabaseUrl).hostname.split(".")[0]; } catch { return ""; }
})();
const enabled = Boolean(
  supabaseUrl && anonKey && tokenA && tokenB &&
  testProjectId && testProjectId === actualProjectId &&
  actualProjectId !== "lyroizvcfonhgdsibvqv"
);

function userClient(token: string): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: "Bearer " + token } },
  });
}

describe.skipIf(!enabled)("Supabase tenant RLS integration", () => {
  let clientA: SupabaseClient<Database>;
  let clientB: SupabaseClient<Database>;
  let userA = "";
  let userB = "";
  let resumeId: string | null = null;
  let storagePath: string | null = null;

  beforeAll(async () => {
    clientA = userClient(tokenA);
    clientB = userClient(tokenB);
    const [{ data: authA, error: errorA }, { data: authB, error: errorB }] = await Promise.all([
      clientA.auth.getUser(tokenA),
      clientB.auth.getUser(tokenB),
    ]);
    if (errorA || errorB || !authA.user || !authB.user || authA.user.id === authB.user.id) {
      throw new Error("Integration test requires two distinct valid Supabase users");
    }
    userA = authA.user.id;
    userB = authB.user.id;

    const { data: workerContext, error: workerContextError } = await clientA.rpc("worker_current_context");
    expect(workerContextError).toBeNull();
    expect(workerContext?.[0]?.user_id).toBe(userA);
    expect(workerContext?.[0]?.worker_enabled).toBe(false);
  });

  afterAll(async () => {
    if (resumeId && clientA && userA) {
      await clientA.from("resumes").delete().eq("id", resumeId).eq("user_id", userA);
    }
    if (storagePath && clientA) {
      await clientA.storage.from("resumes").remove([storagePath]);
    }
  });

  it("isolates resume metadata and private PDF objects by tenant", async () => {
    const marker = randomUUID();
    storagePath = userA + "/worker-rls-" + marker + ".pdf";
    const pdf = new Blob(["%PDF-1.4\n% worker RLS fixture\n%%EOF"], { type: "application/pdf" });

    const { error: uploadError } = await clientA.storage.from("resumes").upload(storagePath, pdf, {
      contentType: "application/pdf",
      upsert: false,
    });
    expect(uploadError).toBeNull();

    const { data: resume, error: insertError } = await clientA.from("resumes").insert({
      user_id: userA,
      name: "RLS integration fixture",
      original_filename: "worker-rls-fixture.pdf",
      storage_bucket: "resumes",
      storage_path: storagePath,
      mime_type: "application/pdf",
      file_size_bytes: pdf.size,
    }).select("id").single();

    expect(insertError).toBeNull();
    expect(resume?.id).toBeTruthy();
    resumeId = resume!.id;

    const { data: leakedRows, error: readError } = await clientB.from("resumes")
      .select("id")
      .eq("id", resumeId);
    expect(readError).toBeNull();
    expect(leakedRows).toEqual([]);

    const { data: changedRows, error: updateError } = await clientB.from("resumes")
      .update({ name: "cross-tenant-write" })
      .eq("id", resumeId)
      .select("id");
    expect(updateError).toBeNull();
    expect(changedRows).toEqual([]);

    const { data: deletedRows, error: deleteError } = await clientB.from("resumes")
      .delete()
      .eq("id", resumeId)
      .select("id");
    expect(deleteError).toBeNull();
    expect(deletedRows).toEqual([]);

    const { data: leakedFile, error: storageReadError } = await clientB.storage
      .from("resumes")
      .download(storagePath);
    expect(storageReadError).not.toBeNull();
    expect(leakedFile).toBeNull();

    const { data: ownerRows, error: ownerError } = await clientA.from("resumes")
      .select("id,name")
      .eq("id", resumeId);
    expect(ownerError).toBeNull();
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows?.[0].name).toBe("RLS integration fixture");
  });
});
