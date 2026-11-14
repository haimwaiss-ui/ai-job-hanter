# AI Job Hunter — Sprint 2 integration pack

## Scope

This pack adds a private resume bucket and owner-folder Storage policies, Auth
profile provisioning, a typed Supabase schema contract, Zod input schemas, an
authenticated application API route, and a worker-side user-scoped client
pattern.

These files are an integration foundation. They have not been deployed or
integration-tested against a live Supabase project.

## Prerequisites

- The Phase 1 migration has been applied.
- The `profiles`, `resumes`, `jobs`, `applications`, and `execution_logs`
  tables and enums exist.
- Next.js App Router, TypeScript, `@supabase/ssr`, `@supabase/supabase-js`,
  and `zod` are installed.
- `@/` resolves to `src/` in tsconfig.

Install missing packages:

```bash
npm install @supabase/ssr @supabase/supabase-js zod
npm install -D supabase
```

## Apply migration

```bash
npx supabase db push
```

Or run `supabase/migrations/002_security_foundation.sql` in the Supabase SQL
Editor after reviewing the target project's current schema.

The migration:
- creates/updates a private `resumes` bucket (10 MiB, PDF only);
- scopes object access to `<auth.uid()>/...`;
- provisions profiles from `auth.users` and backfills existing users;
- corrects composite-FK delete behavior;
- revokes direct client writes to jobs, applications, and execution logs.

Important: because direct writes to applications/jobs/logs are revoked, use
server-side operations that preserve the caller's user JWT and RLS. Do not
switch to the service-role key to work around permission errors.

## Generate authoritative database types

The checked-in `database.types.ts` is a starter contract. Generate the exact
types from the migrated project and replace it:

```bash
npx supabase gen types typescript --project-id "$PROJECT_REF" \
  --schema public > src/lib/supabase/database.types.ts
```

For local Supabase:

```bash
npx supabase gen types typescript --local \
  --schema public > src/lib/supabase/database.types.ts
```

## Environment

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Never prefix a service-role key with `NEXT_PUBLIC_`. This sprint's request
client and worker pattern intentionally use the public key plus a user JWT.

## Storage upload convention

Generate a random object name server-side or in the authenticated client:

```ts
const objectPath = `${user.id}/${crypto.randomUUID()}.pdf`;
const { error } = await supabase.storage
  .from("resumes")
  .upload(objectPath, file, {
    contentType: "application/pdf",
    upsert: false,
  });
```

The Storage policies check the first path segment against `auth.uid()`.
Validate actual PDF content/signature on the server; MIME type and extension
alone do not prove a file is a PDF. Prefer signed URLs with short expiry for
downloads. Never make this bucket public.

## Auth signup

Use Supabase Auth signup normally. The database trigger creates the profile
automatically. Example:

```ts
const { data, error } = await supabase.auth.signUp({
  email,
  password,
  options: { data: { full_name } },
});
```

Do not insert a profile from browser code after signup. Email confirmation
settings may mean the user session is not immediately available.

## Worker token boundary

BullMQ payloads contain `tokenVaultRef`, not a bearer token. Implement a
separate encrypted token vault with strict access control, short retention,
and audit logs. At execution time:
1. Validate the BullMQ payload with `parseWorkerPayload`.
2. Resolve a short-lived user access token from the vault.
3. Build a client with `createTenantWorkerClient(accessToken)`.
4. Call `assertWorkerTenant` and compare the Auth user ID with `payload.userId`.
5. Perform database operations with that client; RLS applies as the user.
6. Never log the token or vault secret.

If the access token has expired, stop and request a fresh delegated user
session/token through an explicitly designed refresh flow. Do not silently
fall back to service_role or bypass RLS.

## Verification checklist

1. Create two test users, A and B.
2. Sign in as A; upload `A_UUID/random.pdf`. Confirm A can list/download it.
3. As B, attempt to read, overwrite, and delete A's object. All must fail.
4. Attempt an object key with B's UUID while authenticated as A. Insert must fail.
5. Sign up a new Auth user; verify exactly one `profiles` row is provisioned.
6. Re-run the profile backfill; verify it does not duplicate rows or overwrite
   existing profile preferences.
7. As A, POST an application using B's `job_id`; expect a generic failure.
8. Submit malformed JSON, invalid UUIDs, extra fields, and oversized strings;
   expect 400/422 and no database mutation.
9. Confirm an ordinary authenticated client cannot directly insert/update
   applications, jobs, or execution logs after migration 002.
10. Verify no service-role secret appears in client bundles, queue payloads,
    logs, or browser network responses.

## Remaining production work

- Add column-level profile grants after agreeing on editable profile fields.
- Add automated pgTAP tests for RLS and Storage isolation.
- Add PDF magic-byte validation, malware scanning, and upload quotas.
- Implement a secure token vault and token refresh/delegation lifecycle.
- Add BullMQ queue definitions, idempotency keys, retry/backoff policy,
  dead-letter handling, and Manual Assist fallback orchestration.
- Add rate limiting and CSRF/origin protections for state-changing routes.
- Add integration tests against a local Supabase stack.
