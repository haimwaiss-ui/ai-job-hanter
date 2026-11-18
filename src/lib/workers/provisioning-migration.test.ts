import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261118141000_worker_user_scoped_provisioning.sql"),
  "utf8",
);

function functionSql(name: string): string {
  const match = migration.match(
    new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "i"),
  );
  if (!match) throw new Error(`Missing worker migration function: ${name}`);
  return match[0].toLowerCase();
}

describe("worker provisioning migration security invariants", () => {
  it("keeps provisioning lease RPCs user-scoped SECURITY INVOKER functions", () => {
    for (const name of [
      "acquire_worker_provisioning_lock",
      "renew_worker_provisioning_lock",
      "release_worker_provisioning_lock",
      "complete_worker_provisioning",
      "worker_current_context",
      "claim_worker_operation",
    ]) {
      expect(functionSql(name), name).toMatch(/security invoker/);
      expect(functionSql(name), name).not.toMatch(/security definer/);
    }

    expect(migration).not.toMatch(/grant\\s+[^;]*\\bto service_role\\s*;/i);
  });

  it("binds worker session and provisioning lease writes to auth.uid() with RLS", () => {
    expect(migration).toMatch(/alter table public\\.worker_sessions enable row level security/i);
    expect(migration).toMatch(/alter table public\\.worker_provisioning_locks enable row level security/i);
    expect(migration).toMatch(/create policy worker_sessions_insert_own_session[\\s\\S]*?user_id = \\(select auth\\.uid\\(\\)\\)[\\s\\S]*?auth_session_id::text/i);
    expect(migration).toMatch(/create policy worker_sessions_update_own_session[\\s\\S]*?user_id = \\(select auth\\.uid\\(\\)\\)[\\s\\S]*?auth_session_id::text/i);
    expect(migration).toMatch(/create policy worker_provisioning_locks_select_own[\\s\\S]*?user_id = \\(select auth\\.uid\\(\\)\\)/i);
    expect(migration).toMatch(/revoke all privileges on table public\\.worker_sessions from public, anon, authenticated, service_role/i);
    expect(migration).toMatch(/revoke all privileges on table public\\.worker_provisioning_locks from public, anon, authenticated, service_role/i);
  });

  it("repairs stale helper references and gates execution-log writes on a live session", () => {
    expect(functionSql("worker_current_context")).toContain("private.is_active_worker_session()");
    expect(functionSql("worker_current_context")).not.toContain("public.is_active_worker_session()");
    expect(functionSql("claim_worker_operation")).toContain("private.is_active_worker_session()");
    expect(functionSql("claim_worker_operation")).not.toContain("public.is_active_worker_session()");

    const logPolicy = migration.match(
      /create policy execution_logs_insert_worker[\\s\\S]*?;/i,
    )?.[0].toLowerCase();
    expect(logPolicy).toContain("private.is_active_worker_session()");
  });

  it("issues the worker claim only for the provisioned, matching Auth session", () => {
    const hook = functionSql("custom_access_token_hook");
    expect(hook).toContain("auth_session_id = event_session_id");
    expect(hook).toContain("provisioned_at is not null");
    expect(hook).toContain("claims - 'worker'");
  });
});
