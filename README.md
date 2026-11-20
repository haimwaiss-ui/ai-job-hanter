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

The worker migrations create `worker_sessions`, `worker_operations`, `worker_provisioning_locks`, `worker_current_context()`, `claim_worker_operation()`, and `custom_access_token_hook(event jsonb)`. Worker execution uses short-lived user-scoped JWTs and ordinary RLS; no service-role credential is used by the worker or its provisioner.

Before running workers, configure Supabase Auth → Hooks → Custom Access Token Hook to call `public.custom_access_token_hook`. Apply `20261118141000_worker_user_scoped_provisioning.sql` after reconciling the timestamped remote migration history. It gives each user an RLS-scoped provisioning lease, repairs the worker RPC references to the private active-session helper, and makes the Auth hook issue `worker=true` only after `provisioned_at` is set. The CLI at `scripts/provision-worker-session.ts` creates a fresh email-OTP session, acquires that user's lease, writes the initial token pair to AWS Secrets Manager, completes provisioning through a SECURITY INVOKER RPC, refreshes the session, verifies `auth.uid()` through `worker_current_context()`, and then stores the rotated token pair. If any step fails after registration, it revokes the row. Run it with `WORKER_USER_ID` and `WORKER_EMAIL`; enter the one-time code at the terminal. Never use or copy the browser session, and never put raw tokens in Vercel, Redis, source control, logs, or metrics.

The worker process uses only `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `REDIS_URL`, `AWS_REGION`, `TOKEN_VAULT_SECRET_PREFIX`, and `WORKER_HANDLER_MODULE`. AWS credentials must be supplied through the worker host's workload identity/IAM role, not copied into the browser or queue payloads. The provisioner uses the user's publishable Supabase key plus a separate OTP session and scoped RLS; it does not use a service-role key.

### Worker queue ingress and revocation

`POST /api/worker/queue` accepts only queue-specific input. The authenticated user ID, operation ID, idempotency key, and opaque token-vault reference are derived server-side. Before enqueueing, the route checks that the signed-in user owns each referenced job, resume, or application and has an active worker-session record. It never creates or updates `worker_sessions`.

Migration `010_worker_session_immediate_revocation.sql` was applied to the connected Supabase project on 2026-11-16 as version `20261116144654`. It makes the worker context, operation-claim RPC, and worker-only RLS policies re-check the JWT `session_id` against the matching non-revoked `worker_sessions` row. A transactional live SQL check confirmed that a matching active session is accepted, a different session is rejected, and revocation invalidates the still-unexpired JWT.

The queue endpoint remains fail-closed with HTTP 409 until `20261118141000_worker_user_scoped_provisioning.sql` is applied, the Custom Access Token Hook is enabled, and the CLI provisioner has registered a dedicated session and stored its credentials in AWS Secrets Manager. The live audit on 2026-11-18 found that the connected project still grants authenticated users only SELECT on `worker_sessions`, has no owner RLS policies on `worker_provisioning_locks`, and retains service-role-only SECURITY DEFINER provisioning-lock RPCs. In addition, `worker_current_context()` and `claim_worker_operation()` still reference the removed `public.is_active_worker_session()` helper. The pending migration does repair `worker_current_context()` and `claim_worker_operation()` to use `private.is_active_worker_session()` and tightens `execution_logs` RLS, but its provisioning section is not safe to apply: it still grants `worker_sessions` and `worker_provisioning_locks` writes only to `service_role`, defines the lease RPCs as `SECURITY DEFINER`, and drops `complete_worker_provisioning()`. The TypeScript provisioner instead uses the user's JWT and calls that RPC. This conflicts with the user-scoped design and the no-service-role-bypass requirement. Keep queue ingress fail-closed; rewrite and verify this migration before applying it.
### Verification

Run `npm run typecheck`, `npm run test:unit`, and `npm run build`. For database checks, use `npx supabase test db` only after the local migration history is reconciled with the timestamped migrations recorded by the connected project. The repository's original `001`–`004` filenames do not yet mirror the remote timestamp versions, so do not run `supabase db push` blindly.

The live signup trigger was tested in a rolled-back transaction with a 200-character metadata name and created a profile with a 160-character name. A read-only worker audit on 2026-11-18 confirmed that `worker_sessions` currently grants `authenticated` SELECT only; INSERT/UPDATE/DELETE remain denied. `worker_provisioning_locks` has RLS enabled but no policies, and the provisioning-lock RPCs remain SECURITY DEFINER and executable only by `service_role`. The live `worker_current_context()` and `claim_worker_operation()` definitions still call the removed `public.is_active_worker_session()` helper. The pending migration `20261118141000_worker_user_scoped_provisioning.sql` is not recorded in the live migration history and is currently internally inconsistent with the TypeScript provisioner: the SQL remains service-role-only for provisioning, while the CLI calls it with a user JWT. Do not apply it in its current form. The live Storage bucket is private.

Remaining security work: rewrite and review `20261118141000_worker_user_scoped_provisioning.sql` so the provisioner and SQL both use owner-scoped RLS plus SECURITY INVOKER RPCs with no service-role grants; then reconcile/apply the migration, enable and verify the Custom Access Token Hook, configure Redis and AWS IAM/Secrets Manager on a dedicated worker host, and run the isolated integration suite before activating workers.
## Employer workspace, web search, and Gmail

The employer workspace uses the additive migration `009_employer_workspace_and_recruiting_pipeline.sql`; Gmail connections use `008_gmail_readonly_oauth_connections.sql`. Employer records are user-scoped with RLS. Applicant details are not exposed to employers until a candidate explicitly applies.

### Live web job search
Set the server-only `TAVILY_API_KEY` environment variable in Vercel to enable multi-source search. Each scan runs separate searches for Israeli job boards (including AllJobs, Drushim, JobMaster, Jobnet and supported ATS job pages), publicly indexed LinkedIn job pages, publicly indexed Facebook pages/groups, publicly indexed X/Twitter posts, and the wider web. Results are tagged by source category in `raw_metadata`, deduplicated by normalized URL, and saved only to the signed-in user's jobs list. Without this key, the endpoint fails closed and explains that search is not configured. This is search-engine discovery, not unrestricted crawling: private groups, login-only posts, deleted content, and pages blocked from indexing cannot be guaranteed or accessed.

Google Custom Search JSON API is closed to new customers, so the app uses a dedicated web-search provider instead.

### Gmail read-only scanning
Configure a Google OAuth web application with this exact authorized redirect URI (the app handles Gmail OAuth directly; do not use the Supabase Auth callback for this flow):
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


### Worker security and verification follow-up

The connected project records `20261118064006_move_worker_session_guard_to_private_schema`, which moved the SECURITY DEFINER worker-session predicate out of the exposed `public` schema and into non-exposed `private`. Do not add `private` to Supabase's Exposed schemas; RLS policies and invoker RPCs call the helper internally.

The follow-up migration `20261118141000_worker_user_scoped_provisioning.sql` is still pending on the live project, and its current SQL does not yet match its filename or the TypeScript provisioner. It retains service-role-only table grants and SECURITY DEFINER lease RPCs, and drops `complete_worker_provisioning()` even though the CLI calls it with the user's JWT. It does repair the stale helper references and the execution-log active-session policy. Do not apply it until the provisioning section is rewritten to owner-scoped RLS and SECURITY INVOKER RPCs, with no service-role grants. The intended provisioner uses a fresh email OTP session and stores the refreshed tokens only in AWS Secrets Manager.

Run the provisioner only from a trusted local terminal after configuring
`WORKER_USER_ID`, `WORKER_EMAIL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `AWS_REGION`, and
`TOKEN_VAULT_SECRET_PREFIX`:

```bash
npx tsx scripts/provision-worker-session.ts
```

The script prompts for the one-time email code. Never use the browser's
existing session or place the code/tokens in Vercel or Redis.

The worker test suite includes strict payload/credential rejection,
tenant-identity assertions, deterministic deduplication keys, bounded retry
configuration, graceful worker-resource shutdown, and CAPTCHA-to-Manual-Assist
fallback. Run:

```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
```

The live integration tests use only the Supabase publishable/anon key plus
user-scoped worker JWTs. They are skipped unless these server-side test
environment variables are provided:

- `WORKER_IDEMPOTENCY_JWT`
- `WORKER_RLS_USER_A_JWT`
- `WORKER_RLS_USER_B_JWT`

The two RLS identities must be different users with active worker sessions.
Never use a service-role key. Run these tests only against an isolated non-production
Supabase project: they create minimal tenant-scoped `worker_operations` records
and intentionally do not delete rows from the database.


## Worker provisioning follow-up

The live signup trigger was tested in a rolled-back transaction with a 200-character metadata name and created a profile with a 160-character name. The live project has the private worker-session helper and RLS policy cleanup migrations applied, but read-only inspection found that `worker_sessions` still denies authenticated INSERT/UPDATE, the provisioning-lock table has no user policies, and the two public worker RPCs still reference the removed `public.is_active_worker_session()` helper. Migration `20261118141000_worker_user_scoped_provisioning.sql` addresses these gaps; it is committed to the worker branch but has not been applied to the live database. The live Storage bucket remains private.

Remaining security work: reconcile and apply the new additive worker provisioning migration, verify the Auth Hook is enabled, configure AWS IAM/Secrets Manager access and Redis on a dedicated worker host, add malware scanning/quarantine for uploaded PDFs, and run the isolated integration suite before activating workers.
