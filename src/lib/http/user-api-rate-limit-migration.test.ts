import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261122144000_user_api_rate_limits.sql"),
  "utf8",
);

describe("user API rate-limit migration security", () => {
  it("binds every counter to auth.uid() and keeps the counter table private", () => {
    expect(migration).toMatch(/user_id uuid not null references auth\.users\(id\) on delete cascade/i);
    expect(migration).toMatch(/alter table private\.user_api_rate_limits enable row level security/i);
    expect(migration).toMatch(/revoke all on table private\.user_api_rate_limits[\s\S]*?from public, anon, authenticated, service_role/i);
    expect(migration).toMatch(/v_user_id uuid := auth\.uid\(\)/i);
  });

  it("uses fixed server-side quotas, a pinned SECURITY DEFINER function, and a bounded counter", () => {
    expect(migration).toMatch(/security definer\s+set search_path = ''/i);
    expect(migration).toMatch(/when 'job_scan' then\s+v_limit := 3;\s+v_window_seconds := 60/i);
    expect(migration).toMatch(/when 'gmail_scan' then\s+v_limit := 2;\s+v_window_seconds := 60/i);
    expect(migration).toMatch(/on conflict \(user_id, bucket\) do update/i);
    expect(migration).toMatch(/least\(limits\.request_count \+ 1, v_limit \+ 1\)/i);
    expect(migration).toMatch(/grant execute on function public\.consume_user_api_rate_limit\(text\)\s+to authenticated/i);
    expect(migration).not.toMatch(/grant execute on function public\.consume_user_api_rate_limit\(text\)\s+to [^;]*service_role/i);
  });
});
