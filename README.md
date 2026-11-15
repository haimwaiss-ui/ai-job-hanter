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

## BullMQ worker infrastructure

The repository contains typed BullMQ queues for `scraper-queue`,
`ai-processing-queue`, and `submission-queue`, with Zod validation at the
enqueue API and worker boundaries. Jobs use tenant-scoped SHA-256 idempotency
keys, deterministic BullMQ job IDs, bounded exponential retries with jitter,
per-queue concurrency/rate limits, timeouts, stalled-job handling, a persistent
dead-letter queue, and graceful shutdown.

### Required activation steps

1. Apply `supabase/migrations/003_worker_infrastructure.sql` after the existing
   schema/security migrations. It adds only the opaque worker-session reference,
   idempotency/lease state, and Manual Assist PDF reference; it does not store
   access or refresh tokens.
2. In Supabase Dashboard, open **Authentication → Hooks → Custom Access Token**
   and enable `public.custom_access_token_hook(event jsonb)`. The hook binds
   `worker=true` to the active `worker_vault_ref`; the worker and RLS verify
   both the authenticated `auth.uid()` and that exact reference. Revoke access
   with `DELETE /api/worker/session`.
3. Configure server-side environment variables from `.env.example`. The Next.js
   API needs `REDIS_URL`, `AWS_REGION`, and `TOKEN_VAULT_SECRET_PREFIX`.
   The dedicated worker host needs those values plus
   `WORKER_HANDLER_MODULE`. Use a private Redis endpoint with TLS in production.
4. Grant the API/worker runtime identity only
   `secretsmanager:CreateSecret`, `GetSecretValue`, and `PutSecretValue`
   for the configured secret prefix. Prefer a workload IAM role; if static AWS
   credentials are unavoidable, store them as server-only environment secrets.
   Never add them to `NEXT_PUBLIC_*`.
5. Implement and deploy a handler module exporting `createWorkerHandlers()`
   with `scrape`, `processAi`, and `submit` methods. The repository deliberately
   does not invent scraping, AI-provider, or application-site adapters. Handlers
   must honor `AbortSignal`, treat page content as untrusted data, and call
   `executeSubmissionWithFallback` for submissions. CAPTCHA, authentication
   challenges, and site blocks must stop automation and enter Manual Assist Mode.
6. Start the dedicated process with `npm run worker`. It must run on a persistent
   Node host, not as a Vercel request function.

The API registration endpoint stores the user's Supabase session in AWS Secrets
Manager and writes only an opaque UUID reference to `worker_sessions`. Redis
payloads contain that reference, never access/refresh tokens. Worker Supabase
clients use the public key plus the short-lived user's JWT; there is no
service-role client or RLS bypass. Manual Assist downloads are signed for 60
seconds from the private `resumes` bucket after tenant ownership checks.

### Verification

- `npm run test:unit` runs payload, idempotency, tenant assertion, retry,
  shutdown, and CAPTCHA fallback unit tests.
- `npm run test:integration` runs two-user RLS isolation checks when
  `WORKER_RLS_USER_A_JWT`, `WORKER_RLS_USER_B_JWT`, and (for the database
  lease/idempotency test) `WORKER_IDEMPOTENCY_JWT` are configured alongside
  the public Supabase URL/key. The first two are ordinary user JWTs; the
  idempotency token must belong to a user with an active worker session. Never
  use a service-role credential.
- The live Supabase project and Vercel project still require migration/hook,
  Redis, AWS Secrets Manager and worker-host configuration before the runtime
  can process real jobs. The scraping/AI/submission business adapters are not
  implemented by this infrastructure change.
