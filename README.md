# AI Job Hunter — Preview build

A Hebrew, RTL-first Next.js preview for reviewing the product experience. The current UI includes:
- sign-in and sign-up screens (Supabase Auth when configured);
- a demo entry path so the interface can be explored before backend credentials are connected;
- dashboard, job list/search, applications, resume upload placeholder, profile, and settings;
- demo data stored in the browser only.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. Without Supabase environment values, use "כניסה למצב הדגמה ללא חשבון". Demo jobs and the selected resume filename are stored in localStorage/sessionStorage and are not uploaded or shared.

## Deploy preview to Vercel

1. Import `haimwaiss-ui/ai-job-hanter` from GitHub in Vercel.
2. Framework preset: Next.js; build command: `npm run build`; output: default.
3. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` after a Supabase project has been configured.
4. Deploy. Do not add a service-role key to client environment variables.

## Supabase setup

Apply migrations in order:
1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_security_foundation.sql`

Then configure Supabase Auth redirect URLs for the deployed domain and local development. Generate authoritative database types from the live project:

```bash
npx supabase gen types typescript --project-id "$PROJECT_REF" --schema public > src/lib/supabase/database.types.ts
```

## Important preview limitations

- Demo mode is not real authentication and must not be used for storing real personal data.
- Resume selection currently stores only the filename locally; no PDF upload occurs until Supabase Storage is configured.
- Job records are sample data; scraping and AI matching are not connected.
- Application status and profile editing are preview interactions, not persisted backend features.
- Submission automation, queues, and status synchronization are not enabled.
- The database migrations have been authored but have not yet been applied to a live Supabase project.
- Build/deployment status must be confirmed from the hosting provider before treating the site as live.

## Security

Never expose a Supabase service-role key in browser code or `NEXT_PUBLIC_*` variables. Preserve user-scoped JWT and RLS boundaries for all worker operations. CAPTCHA and anti-bot blocks must enter Manual Assist Mode rather than being bypassed.

## Sprint 2.2 — tenant security and typed access

The connected Supabase project received three additive migrations on 2026-11-15: `security_hardening_private_resume_storage_auth_and_grants` (version `20261115141300`), `allow_owner_resume_object_cleanup` (`20261115141530`), and `worker_infrastructure_tenant_safe_session_scoped` (`20261115141627`). The matching SQL is stored in `supabase/migrations/005_*`, `006_*`, and `007_*`.

The `resumes` bucket is private, limited to PDF files up to 10 MiB, and accepts only canonical paths of the form `<user-uuid>/<uuid-v4>.pdf`. Storage SELECT/INSERT/DELETE policies check the authenticated owner in the path. Object replacement/upsert is not permitted. The resume API checks the PDF signature and coordinates metadata deletion with object cleanup.

The existing `on_auth_user_created` trigger remains the single profile-provisioning mechanism. It now bounds untrusted signup `full_name` metadata to 160 characters, preserves user-edited profile fields on conflict, synchronizes email changes, and backfills only missing profiles. The browser must not insert a profile separately.

`src/lib/supabase/database.types.ts` was regenerated from the connected live schema after the worker migration. Regenerate it after every schema change with `npx supabase gen types typescript --project-id "$PROJECT_REF" --schema public > src/lib/supabase/database.types.ts`.

The broad table ACLs for `anon` and `authenticated` were revoked. Authenticated users receive only the required table reads and column-level writes; RLS remains enabled on every user-owned table. Default privileges for objects created by `postgres` in `public` were also tightened. The management connection cannot change the separate `supabase_admin` default-privilege template, so avoid creating application tables as `supabase_admin` without reviewing their grants.

### Worker setup is deliberately fail-closed

The worker migration creates `worker_sessions`, `worker_operations`, `worker_current_context()`, `claim_worker_operation()`, and `custom_access_token_hook(event jsonb)`. `worker_sessions` is not self-service: authenticated users can read only their own opaque vault reference and cannot insert, update, or delete worker-session rows. The access-token hook binds the `worker` claim to a dedicated `auth_session_id`; do not register a user's normal browser session as a worker session.

Before running workers, configure Supabase Auth → Hooks → Custom Access Token Hook to call `public.custom_access_token_hook`. A trusted server-side provisioning flow must create a separate Auth session, store its access/refresh tokens plus `sessionId` in AWS Secrets Manager, and insert the matching `worker_sessions` row. That provisioning flow is not implemented yet. The BullMQ runtime also requires Redis, AWS Secrets Manager credentials, and a real module exporting `createWorkerHandlers()`.

Worker process variables are server-only: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `REDIS_URL`, `AWS_REGION`, `TOKEN_VAULT_SECRET_PREFIX`, and `WORKER_HANDLER_MODULE`. No service-role key is used by browser code or queue payloads.

### Worker queue ingress and revocation

`POST /api/worker/queue` accepts only queue-specific input. The authenticated user ID, operation ID, idempotency key, and opaque token-vault reference are derived server-side. Before enqueueing, the route checks that the signed-in user owns each referenced job, resume, or application and has an active worker-session record. It never creates or updates `worker_sessions`.

Migration `010_worker_session_immediate_revocation.sql` makes the worker context, operation-claim RPC, and worker-only RLS policies re-check the JWT `session_id` against the matching non-revoked `worker_sessions` row. Revoking a worker session therefore stops database access before the JWT expires.

The queue endpoint remains fail-closed with HTTP 409 until a trusted control-plane provisioner creates a dedicated Auth session and stores its tokens in AWS Secrets Manager. Do not restore the old self-registration route from the unmerged BullMQ draft; authenticated users have SELECT-only access to `worker_sessions`.
### Verification

Run `npm run typecheck`, `npm run test:unit`, and `npm run build`. For database checks, use `npx supabase test db` only after the local migration history is reconciled with the timestamped migrations recorded by the connected project. The repository's original `001`–`004` filenames do not yet mirror the remote timestamp versions, so do not run `supabase db push` blindly.

The live signup trigger was tested in a rolled-back transaction with a 200-character metadata name and created a profile with a 160-character name. Live privilege checks confirmed that profile INSERT, profile email UPDATE, resume parsed-text UPDATE, application status INSERT, and worker-session INSERT/UPDATE/DELETE are denied to `authenticated`. The live Storage bucket is private.

Remaining security work: configure leaked-password protection in Supabase Auth, add malware scanning/quarantine for uploaded PDFs, and implement the trusted worker-session provisioning flow before enabling worker execution.
## Employer workspace, web search, and Gmail

The employer workspace uses the additive migration `009_employer_workspace_and_recruiting_pipeline.sql`; Gmail connections use `008_gmail_readonly_oauth_connections.sql`. Employer records are user-scoped with RLS. Applicant details are not exposed to employers until a candidate explicitly applies.

### Live web job search
Set the server-only `TAVILY_API_KEY` environment variable in Vercel to enable live web search and import of job listing results. The scan searches selected job boards and stores new links in the signed-in user's jobs list, deduplicating by source URL. Without this key, the endpoint fails closed and explains that search is not configured.

Google Custom Search JSON API is closed to new customers, so the app uses a dedicated web-search provider instead.

### Gmail read-only scanning
Configure a Google OAuth web application with this exact redirect URI:
`https://ai-job-hanter.vercel.app/api/gmail/callback`

Enable the Gmail API and add these server-only Vercel environment variables:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GMAIL_TOKEN_ENCRYPTION_KEY` — a random 32-byte key encoded as base64.

The app requests only `https://www.googleapis.com/auth/gmail.readonly`. Refresh tokens are encrypted with AES-256-GCM before storage. The scan checks recent message headers/snippets for job-related terms and stores matching snippets as private job records; it does not send or modify mail. Never expose these credentials through `NEXT_PUBLIC_*`.

### Email OTP authentication
The login screen uses email one-time codes. In Supabase Dashboard → Authentication → Email Templates → Magic Link, change the template to include `{{ .Token }}` and remove `{{ .ConfirmationURL }}` so the email contains the six-digit code expected by the UI. The code is verified with `verifyOtp`.

### Israeli locality picker
The location selector queries the official Population and Immigration Authority locality dataset at data.gov.il and only commits a value after the user selects a returned locality. It requires the upstream dataset API to remain reachable.
