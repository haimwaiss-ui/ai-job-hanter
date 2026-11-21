import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261121162000_repair_worker_context_rpc_private_helper.sql"),
  "utf8",
);

describe("worker context RPC migration", () => {
  it("uses the private session guard instead of the removed public helper", () => {
    expect(migration).toContain("private.is_active_worker_session()");
    expect(migration).not.toContain("public.is_active_worker_session()");
  });

  it("keeps both worker RPCs SECURITY INVOKER", () => {
    expect(migration).toMatch(/function public\.worker_current_context\(\)[\s\S]*?security invoker/i);
    expect(migration).toMatch(/function public\.claim_worker_operation\([\s\S]*?security invoker/i);
    expect(migration).not.toMatch(/function public\.claim_worker_operation\([\s\S]*?security definer/i);
  });

  it("requires the authenticated worker identity and grants only the intended RPCs", () => {
    expect(migration).toContain("current_user_id := auth.uid()");
    expect(migration).toContain("private.is_active_worker_session() is not true");
    expect(migration).toContain("to authenticated");
    expect(migration).not.toMatch(/grant\\s+execute[\\s\\S]*?to\\s+service_role/i);
    expect(migration).not.toMatch(/security\\s+definer/i);
  });
});
