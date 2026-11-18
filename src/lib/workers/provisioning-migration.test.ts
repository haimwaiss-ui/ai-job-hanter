import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261118141000_worker_user_scoped_provisioning.sql"),
  "utf8",
);
const normalizedMigration = migration.toLowerCase();

function functionSql(name: string): string {
  const marker = `create or replace function public.${name.toLowerCase()}(`;
  const start = normalizedMigration.indexOf(marker);
  if (start < 0) throw new Error(`Missing worker migration function: ${name}`);
  const end = migration.indexOf("$$;", start);
  if (end < 0) throw new Error(`Unterminated worker migration function: ${name}`);
  return normalizedMigration.slice(start, end + 3);
}

function statementSql(prefix: string): string {
  const start = normalizedMigration.indexOf(prefix.toLowerCase());
  if (start < 0) throw new Error(`Missing worker migration statement: ${prefix}`);
  const end = migration.indexOf(";", start);
  if (end < 0) throw new Error(`Unterminated worker migration statement: ${prefix}`);
  return normalizedMigration.slice(start, end + 1);
}

describe("worker provisioning migration security invariants", () => {
  it("keeps provisioning and worker-context RPCs user-scoped SECURITY INVOKER functions", () => {
    for (const name of [
      "acquire_worker_provisioning_lock",
      "renew_worker_provisioning_lock",
      "release_worker_provisioning_lock",
      "complete_worker_provisioning",
      "worker_current_context",
      "claim_worker_operation",
    ]) {
      const body = functionSql(name);
      expect(body, name).toContain("security invoker");
      expect(body, name).not.toContain("security definer");
    }

    const grants = migration
      .split(";")
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.startsWith("grant "));
    expect(grants.some((grant) => grant.includes("to service_role"))).toBe(false);
  });

  it("binds worker-session and provisioning-lease writes to auth.uid() with RLS", () => {
    expect(normalizedMigration).toContain(
      "alter table public.worker_sessions enable row level security",
    );
    expect(normalizedMigration).toContain(
      "alter table public.worker_provisioning_locks enable row level security",
    );

    const sessionInsert = statementSql("create policy worker_sessions_insert_own_session");
    const sessionUpdate = statementSql("create policy worker_sessions_update_own_session");
    const lockSelect = statementSql("create policy worker_provisioning_locks_select_own");

    for (const policy of [sessionInsert, sessionUpdate, lockSelect]) {
      expect(policy).toContain("user_id = (select auth.uid())");
    }
    for (const policy of [sessionInsert, sessionUpdate]) {
      expect(policy).toContain("auth_session_id::text");
      expect(policy).toContain("auth.jwt() ->> 'session_id'");
    }

    expect(normalizedMigration).toContain(
      "revoke all privileges on table public.worker_sessions from public, anon, authenticated, service_role",
    );
    expect(normalizedMigration).toContain(
      "revoke all privileges on table public.worker_provisioning_locks from public, anon, authenticated, service_role",
    );
  });

  it("repairs stale helper references and gates execution-log writes on an active session", () => {
    const contextRpc = functionSql("worker_current_context");
    const claimRpc = functionSql("claim_worker_operation");
    expect(contextRpc).toContain("private.is_active_worker_session()");
    expect(contextRpc).not.toContain("public.is_active_worker_session()");
    expect(claimRpc).toContain("private.is_active_worker_session()");
    expect(claimRpc).not.toContain("public.is_active_worker_session()");

    const logPolicy = statementSql("create policy execution_logs_insert_worker");
    expect(logPolicy).toContain("private.is_active_worker_session()");
  });

  it("issues the worker claim only for the provisioned, matching Auth session", () => {
    const hook = functionSql("custom_access_token_hook");
    expect(hook).toContain("auth_session_id = event_session_id");
    expect(hook).toContain("provisioned_at is not null");
    expect(hook).toContain("claims - 'worker'");
  });
});
